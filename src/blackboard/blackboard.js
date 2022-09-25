import * as cheero from 'cheerio';
import { EventEmitter } from 'events';

/**
 * The cache map that stores all available registered Blackboard client instances.
 * @type {Map<string, BlackboardClient>}
 */
export const RegisteredClients = new Map();

// This class will act as an API client for each user
export class BlackboardClient extends EventEmitter {
    #base = 'https://bbhosted.cuny.edu';
    #user_agent =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36';
    #client = {
        name: null,
        cookies: null,
    };

    /**
     * @typedef {Object} Client
     * @property {String=} name The name of the current authenticated user.
     * @property {String} cookies The cookies to use for the current authenticated user.
     */

    constructor() {
        // Initialize the EventEmitter class
        super(...arguments);
    }

    /**
     * Ensures the current instance has authenticated client data with valid credentials.
     * @private
     */
    _ensure_authenticated() {
        // Ensure client has been authenticated
        if (this.#client.name === null)
            throw new Error(
                'BlackboardClient: Client has not been imported/authenticated yet. Please call BlackboardClient.import({ cookies }) first.'
            );
    }

    /**
     * Sets the user agent to use for all requests.
     * @param {String} user_agent
     */
    set_user_agent(user_agent) {
        this.#user_agent = user_agent;
    }

    /**
     * Imports or initiializes a new Blackboard client.
     *
     * @param {Client} client
     */
    async import(client) {
        // Destructure the client object with default values
        const { cookies } = client;

        // Make a fetch request to Blackboard base URL to get the raw HTML
        const response = await fetch(this.#base, {
            method: 'GET',
            headers: {
                'user-agent': this.#user_agent,
                cookie: cookies,
            },
        });

        // Parse the text HTML into a cheerio object
        const text = await response.text();

        // Cache the cheerio HTML DOM object
        const $ = cheero.load(text);

        // Strip the nav link to only contain the user name
        $('#global-nav-link').children().remove();

        // Attempt to safely parse the user name to validate the cookies session
        let is_logged_in = false;
        try {
            client.name = $('#global-nav-link').text().trim();
            is_logged_in = client.name.length > 0;
        } catch (error) {
            // Silently ignore this likely means the cookies are invalid
        }

        // If the user is logged in, merge the provided client data with the current client data
        if (is_logged_in) this.#client = Object.assign(this.#client, client);

        // Return a Boolean based on a valid user name was found
        return is_logged_in;
    }

    /**
     * Exports the current client to a JSON object.
     * @returns {Client}
     */
    export() {
        // Ensure client has been authenticated
        this._ensure_authenticated();

        // Return a shallow copy of the client
        return Object.assign({}, this.#client);
    }

    /**
     * @typedef {Object} Course
     * @property {String} name The name of the course.
     * @property {Number} updated_at The last time the course was updated in milliseconds.
     * @property {Object} urls The URLs for the course.
     * @property {String} urls.grades The URL to the grades page for the course.
     * @property {String} urls.class The URL to the class page for the course.
     */

    /**
     * Returns all of the classes the user is enrolled in.
     * Note! This method caches the courses in the returned Map.
     * You may clear the cache by calling the `Map.clear()` method on the returned Map.
     * @param {Number=} max_age The maximum age of each of class in milliseconds. Defaults to `6 months` max age.
     * @returns {Promise<Object<string, Course>>}
     */
    async get_all_courses(max_age = 1000 * 60 * 60 * 24 * 30 * 6) {
        // Ensure client has been authenticated
        this._ensure_authenticated();

        // Fetch the grades stream viewer POST URL
        const response = await fetch(`${this.#base}/webapps/streamViewer/streamViewer`, {
            method: 'POST',
            headers: {
                'user-agent': this.#user_agent,
                cookie: this.#client.cookies,
                accept: 'text/javascript, text/html, application/xml, text/xml, */*',
                'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
                pragma: 'no-cache',
                'cache-control': 'no-cache',
            },
            body: `cmd=loadStream&streamName=mygrades&providers=%7B%7D&forOverview=false`,
        });

        // Parse the response as JSON to retrieve the courses
        const { sv_extras, sv_streamEntries } = await response.json();
        const { sx_courses } = sv_extras;

        // Ensure both grade entries and courses are present
        if (!Array.isArray(sv_streamEntries) || !Array.isArray(sx_courses))
            throw new Error('Invalid courses payload received from Blackboard.');

        // Iterate through each grade entry and match it to a course
        let courses = [];
        sv_streamEntries.forEach((grade) => {
            const { se_courseId, se_timestamp, se_rhs } = grade;
            const course = sx_courses.find((course) => course.id === se_courseId);
            if (course) {
                const { name, homePageUrl } = course;
                const updated_at = new Date(se_timestamp).getTime();
                if (updated_at + max_age > Date.now()) {
                    // Add the course to the cache with a easy to remember index based identifier
                    // This will make it easier to reference the course later through commands
                    courses.push({
                        id: se_courseId,
                        name,
                        updated_at,
                        urls: {
                            grades: se_rhs,
                            class: homePageUrl,
                        },
                    });
                }
            }
        });

        // Sort the courses by the last updated time
        courses = courses.sort((a, b) => b.updated_at - a.updated_at);

        // Conver the courses into an object with the index as the #key
        const object = {};
        courses.forEach((course, index) => (object[`#${index + 1}`] = course));

        // Return the courses
        return object;
    }

    /**
     * @typedef {Object} Assignment
     * @property {String} id The ID of the assignment.
     * @property {String=} url The URL to the assignment.
     * @property {String} name The name of the assignment.
     * @property {Number} cursor The position cursor of the assignment.
     * @property {('GRADED'|'SUBMITTED'|'UPCOMING')} status The status constant of the assignment.
     * @property {Object=} grade The grade object of the assignment.
     * @property {String=} grade.score The student's score of the assignment.
     * @property {String=} grade.possible The maximum possible score of the assignment.
     * @property {String=} grade.percent The percentage score of the assignment.
     * @property {Number} updated_at The last time the assignment was updated in milliseconds.
     * @property {Number} deadline_at The due date of the assignment in milliseconds.
     */

    /**
     * Returns all assignments for a given course ID.
     * Note! You may use the `get_all_courses()` method to get all course IDs.
     *
     * @param {Course} course The course to get assignments for.
     * @returns {Promise<Array<Assignment>>}
     */
    async get_all_assignments(course) {
        // Ensure client has been authenticated
        this._ensure_authenticated();

        // Fetch the raw HTML for the course from the grades URL
        const response = await fetch(`${this.#base}${course.urls.grades}`, {
            method: 'GET',
            headers: {
                'user-agent': this.#user_agent,
                cookie: this.#client.cookies,
            },
        });

        // Parse the text HTML into a cheerio object
        const text = await response.text();
        const $ = cheero.load(text);

        // Retrieve the table of assignments
        const assignments = [];
        $('#grades_wrapper')
            .children()
            .each((_, element) => {
                // Convert the element to a cheerio object
                element = $(element);

                // Retrieve properties about the assignment
                const id = element.attr('id');
                const cursor = +element.attr('position');
                const name = element.find('.cell.gradable').children().eq(0).text().trim();
                const status = element.find('.cell.activity.timestamp').find('.activityType').text().toUpperCase();
                const updated_at = +element.attr('lastactivity');
                const deadline_at = +element.attr('duedate');

                // Do not include assignments that have no status as they are likely indicator elements
                if (!status) return;

                // Attempt to parse the grade cell into grade components
                const [scored, total] = element
                    .find('.cell.grade')
                    ?.text?.()
                    .split(' ')
                    .join('')
                    .split('\n')
                    .join('')
                    .split('/');

                // Generate a grade object if both a valid scored and total properties are present
                let grade = null;
                if (!isNaN(+scored + +total))
                    grade = {
                        score: +scored,
                        possible: +total,
                        percent: +((+scored / +total) * 100).toFixed(2),
                    };

                // Parse a url object depending on whether the name cell has a onclick handler
                let url = null;
                let onclick = element.find('.cell.gradable').children().eq(0).attr('onclick');
                if (onclick) {
                    // Parse the onclick based on double quotes
                    onclick = onclick.split("'")?.[1]?.split?.("'")?.[0];
                    if (onclick) url = onclick;
                }

                // Add the assignment to the list
                assignments.push({
                    id,
                    url,
                    name,
                    cursor,
                    status,
                    grade,
                    updated_at,
                    deadline_at,
                });
            });

        // Sort the assignments by their cursor
        assignments.sort((a, b) => a.cursor - b.cursor);

        // Return the assignments
        return assignments;
    }

    /**
     * Returns the base URL used for requests.
     * @returns {String}
     */
    get base() {
        return this.#base;
    }

    /**
     * Returns the user name of the current authenticated user.
     * @returns {String}
     */
    get name() {
        return this.#client.name;
    }

    /**
     * Returns the cookies of the current authenticated user.
     * @returns {String}
     */
    get cookies() {
        return this.#client.cookies;
    }

    /**
     * Returns the user agent used for requests.
     * @returns {String}
     */
    get user_agent() {
        return this.#user_agent;
    }
}
