import * as cheero from 'cheerio';
import { EventEmitter } from 'events';
import { sleep, with_retries } from '../utils.js';

export const BLACKBOARD_URL_BASE = 'https://bbhosted.cuny.edu';
export const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36';

/**
 * The cache map that stores all available registered Blackboard client instances.
 * @type {Map<string, BlackboardClient>}
 */
export const RegisteredClients = new Map();

// This class will act as an API client for each user
export class BlackboardClient extends EventEmitter {
    #keep_alive;
    #base = BLACKBOARD_URL_BASE;
    #user_agent = DEFAULT_USER_AGENT;
    #client = {
        name: null,
        cookies: null,
        cache: {},
    };

    /**
     * @typedef {Object} Client
     * @property {String=} name The name of the current authenticated user.
     * @property {String} cookies The cookies to use for the current authenticated user.
     * @property {Object<string,any>} cache Cached data for the current authenticated user.
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
        // Ensure client has valid cookies for authentication
        // Throw the catch-all no client error to alert the user of invalid cookies
        if (this.#client.cookies === null) throw new Error('NO_CLIENT');
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
     * @param {Number=} retries The number of times to retry the authentication process.
     * @param {Number=} delay The delay in milliseconds between each retry.
     * @returns {Promise<Boolean>}
     */
    async import(client, retries = 5, delay = 1000) {
        // Create a shallow copy of the client object to prevent mutation of the original object
        client = Object.assign({}, client);

        // Parse the response as text HTML
        const text = await with_retries(retries, delay, async () => {
            // Make the fetch request to the Blackboard homepage
            const response = await fetch(this.#base, {
                method: 'GET',
                headers: {
                    'user-agent': this.#user_agent,
                    cookie: client.cookies,
                },
            });

            // Ensure the response status is 200
            if (response.status !== 200) throw new Error('Invalid response status code.');

            // Return the response
            return await response.text();
        });

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

        // Ensure the user is logged in and this is not a ping import
        if (client.ping !== true) {
            // Merge the client data with the internal client data
            this.#client = Object.assign(this.#client, client);

            // Perform keep-alive if the client is logged in
            if (is_logged_in) {
                // Clear the old keep alive interval if it exists
                if (this.#keep_alive) clearInterval(this.#keep_alive);

                // Start a new keep alive interval
                let failures = 0;
                this.#keep_alive = setInterval(async () => {
                    // Perform an import with just the cookies to keep the session alive
                    let alive = false;
                    try {
                        alive = await this.import({ cookies, ping: true });
                    } catch (error) {}

                    // Expire the cookies and emit 'expired' event if the session is no longer alive
                    if (!alive) {
                        // Increment the failure count
                        failures++;

                        // Expire the client if the failure count is greater than 5 failures
                        if (failures > 5) {
                            this.#client.cookies = null;
                            this.emit('expired');
                        }
                    }
                }, 1000 * 60 * 5); // Keep Alive every 5 minutes
            } else {
                // Clear the cookies value if the user is not logged in
                this.#client.cookies = null;
            }
        }

        // Return a Boolean based on a valid user name was found
        return is_logged_in;
    }

    /**
     * Exports the current client to a JSON object.
     * @returns {Client}
     */
    export() {
        // Return a shallow copy of the client to allow for the caller to modify the object without affecting the internal client data
        return Object.assign({}, this.#client);
    }

    /**
     * @typedef {Object} Course
     * @property {String} id The course ID.
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
     * @param {Number=} max_cache_age The maximum age of the cached data in milliseconds. Defaults to `1 day` max age.
     * @param {Number=} retries The number of times to retry the fetch process.
     * @param {Number=} delay The delay in milliseconds between each retry.
     * @returns {Promise<Object<string, Course>>}
     */
    async get_all_courses(
        max_age = 1000 * 60 * 60 * 24 * 30 * 6,
        max_cache_age = 1000 * 60 * 60 * 24,
        retries = 5,
        delay = 1000
    ) {
        // Ensure client has been authenticated
        this._ensure_authenticated();

        // Retrieve courses from cache or fallback to fetching them from Blackboard
        let courses;
        const cache = this.#client.cache.courses;
        if (cache && Date.now() - cache.updated_at < max_cache_age) {
            courses = cache.value;
        } else {
            // Fetch the grades stream viewer POST URL as JSON data
            const json = await with_retries(retries, delay, async () => {
                // Make fetch request to the Blackboard API endpoint
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

                // Ensure the response status is 200
                if (response.status !== 200) throw new Error('Invalid response status code.');

                // Return the response
                return await response.json();
            });

            // Destructure the JSON data into the courses array
            const { sv_extras, sv_streamEntries } = json;
            const { sx_courses } = sv_extras;

            // Ensure both grade entries and courses are present
            if (!Array.isArray(sv_streamEntries) || !Array.isArray(sx_courses))
                throw new Error('Invalid courses payload received from Blackboard.');

            // Iterate through each grade entry and match it to a course
            courses = [];
            sv_streamEntries.forEach((grade) => {
                const { se_courseId, se_timestamp, se_rhs } = grade;
                const course = sx_courses.find((course) => course.id === se_courseId);
                if (course) {
                    // Store the course object among the courses
                    const { name, homePageUrl } = course;
                    const updated_at = new Date(se_timestamp).getTime();

                    // Ensure the course has a valid updated_at timestamp
                    if (updated_at > 0)
                        courses.push({
                            id: se_courseId,
                            name: name.split('[')[0].trim() || name, // Simplify the course name by removing codes/identifiers
                            updated_at: new Date(se_timestamp).getTime(),
                            urls: {
                                grades: se_rhs,
                                class: homePageUrl,
                            },
                        });
                }
            });

            // If no courses were found, retry the request if retries available
            if (courses.length === 0 && retries > 0) {
                // Sleep for the delay
                await sleep(delay);

                // Retry the request with one less retry
                return await this.get_all_courses(max_age, max_cache_age, retries - 1, delay);
            }

            // Sort the courses by the updated timestamp
            courses = courses.sort((a, b) => b.updated_at - a.updated_at);

            // Cache the courses for future use
            this.#client.cache.courses = {
                updated_at: Date.now(),
                value: courses,
            };

            // Emit the persist event to notify the caller that the client data has changed
            this.emit('persist');
        }

        // Conver the courses into an object with the index as the #key
        const filtered = {};
        courses.forEach((course, index) => {
            // Filter the course object by the max age
            if (course.updated_at + max_age > Date.now()) {
                // Add the course to the object
                filtered[`#${index + 1}`] = course;
            }
        });

        // Return the filtered courses
        return filtered;
    }

    /**
     * @typedef {Object} Assignment
     * @property {String} id The ID of the assignment.
     * @property {String} url The URL to the assignment.
     * @property {String} name The name of the assignment.
     * @property {Number} cursor The position cursor of the assignment.
     * @property {('GRADED'|'SUBMITTED'|'UPCOMING')} status The status constant of the assignment.
     * @property {Object=} grade The grade object of the assignment.
     * @property {String=} grade.comments The instructor's grading comments for the assignment.
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
     * @param {Number=} retries The number of times to retry the fetch process.
     * @param {Number=} delay The delay in milliseconds between each retry.
     * @returns {Promise<Array<Assignment>>}
     */
    async get_all_assignments(course, retries = 5, delay = 1000) {
        // Ensure client has been authenticated
        this._ensure_authenticated();

        // Fetch the raw HTML for the course from the grades URL
        const text = await with_retries(retries, delay, async () => {
            // Make fetch request to the Blackboard API endpoint
            const response = await fetch(`${this.#base}${course.urls.grades}`, {
                method: 'GET',
                headers: {
                    'user-agent': this.#user_agent,
                    cookie: this.#client.cookies,
                },
            });

            // Ensure the response status is 200
            if (response.status !== 200) throw new Error('Invalid response status code.');

            // Return the response
            return await response.text();
        });

        // Parse the text HTML into a cheerio object
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
                if (!isNaN(+scored + +total)) {
                    // Parse the comments text from the grade cell
                    let comments = null;
                    const feedback = element.find('.cell.grade')?.find?.('.grade-feedback')?.attr?.('onclick');
                    if (feedback) {
                        const chunks = feedback.split('<p>');
                        if (chunks.length > 1)
                            comments = chunks
                                .slice(1)
                                .map((chunk) => chunk.split('</p>')[0])
                                .join('\n');
                    }

                    // Fill the grade object with the parsed values
                    grade = {
                        score: +scored,
                        possible: +total,
                        percent: +((+scored / +total) * 100).toFixed(2),
                        comments,
                    };
                }

                // Add the assignment to the list
                assignments.push({
                    id,
                    url: `/webapps/assignment/uploadAssignment?action=showHistory&course_id=${course.id}&outcome_definition_id=${id}`,
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
     * Destroys this client and clears all cookies.
     */
    destroy() {
        // Expire the client object
        this.#client = null;

        // Clear the keep alive interval if it exists
        if (this.#keep_alive) clearInterval(this.#keep_alive);
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
