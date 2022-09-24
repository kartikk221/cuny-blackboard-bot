import { readFile, writeFile } from 'fs/promises';
import * as cheero from 'cheerio';
import { log } from './utils.js';

// This map will store the unique clients for each user
export const RegisteredClients = new Map();

// This class will act as an API client for each user
export class BlackboardClient {
    #base = 'https://bbhosted.cuny.edu/';
    #cookies = null;
    #user_name = null;
    #user_agent = null;

    constructor(cookies, user_agent) {
        this.#cookies = cookies;
        this.#user_agent =
            user_agent ||
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36';
    }

    /**
     * Initializes the client by validating the cookies with Blackboard servers.
     * You may use this method to `ping` Blackboard and ensure cookies don't expire.
     * @returns {Promise<Boolean>}
     */
    async initialize() {
        // Make a fetch request to Blackboard base URL to get the raw HTML
        const response = await fetch(this.#base, {
            method: 'GET',
            headers: {
                'user-agent': this.#user_agent,
                cookie: this.#cookies,
            },
        });

        // Parse the text HTML into a cheerio object
        const text = await response.text();

        // Cache the cheerio HTML DOM object
        const $ = cheero.load(text);

        // Strip the nav link to only contain the user name
        $('#global-nav-link').children().remove();

        // Attempt to safely cache the user name
        // If this errors, the user is not logged in
        try {
            this.#user_name = $('#global-nav-link').text().trim();
        } catch (error) {}

        // Return a Boolean based on a valid user name was found
        return this.#user_name !== null;
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
        // Fetch the grades stream viewer POST URL
        const response = await fetch(`${this.#base}/webapps/streamViewer/streamViewer`, {
            method: 'POST',
            headers: {
                'user-agent': this.#user_agent,
                cookie: this.#cookies,
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
        const courses = {};
        sv_streamEntries.forEach((grade) => {
            const { se_courseId, se_timestamp, se_rhs } = grade;
            const course = sx_courses.find((course) => course.id === se_courseId);
            if (course) {
                const { name, homePageUrl } = course;
                const updated_at = new Date(se_timestamp).getTime();
                if (updated_at + max_age > Date.now()) {
                    // Add the course to the cache
                    courses[se_courseId] = {
                        name,
                        updated_at,
                        urls: {
                            grades: se_rhs,
                            class: homePageUrl,
                        },
                    };
                }
            }
        });

        // Return the courses
        return courses;
    }

    /**
     * @typedef {Object} Assignment
     * @property {String} id The ID of the assignment.
     * @property {String} url The URL to the assignment.
     * @property {String} name The name of the assignment.
     * @property {Number} cursor The position cursor of the assignment.
     * @property {('GRADED'|'SUBMITTED'|'UPCOMING')} status The status constant of the assignment.
     * @property {Object} grade The grade object of the assignment.
     * @property {String} grade.score The student's score of the assignment.
     * @property {String} grade.possible The maximum possible score of the assignment.
     * @property {String} grade.percent The percentage score of the assignment.
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
        // Fetch the raw HTML for the course from the grades URL
        const response = await fetch(`${this.#base}${course.urls.grades}`, {
            method: 'GET',
            headers: {
                'user-agent': this.#user_agent,
                cookie: this.#cookies,
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
     * Returns the user name of the current authenticated user.
     * @returns {String}
     */
    get name() {
        return this.#user_name;
    }

    /**
     * Returns the cookies of the current authenticated user.
     * @returns {String}
     */
    get cookies() {
        return this.#cookies;
    }
}

/**
 * Registers a new Blackboard API client with the given credentials.
 *
 * @param {String} identifier The identifier of the client.
 * @param {String} cookies The cookies to use for the client.
 * @param {String} ping_interval The interval to ping the server in milliseconds to keep cookies alive.
 * @returns {Promise<BlackboardClient|void>}
 */
export async function register_client(identifier, cookies, ping_interval = 1000 * 60 * 5) {
    // Create a new Blackboard client with the cookies
    const client = new BlackboardClient(cookies);

    // Initialize the client to validate the cookies
    let valid = false;
    try {
        valid = await client.initialize();
    } catch (error) {}

    // Ensure the client is valid
    if (!valid) return;

    // Retrieve the old client if it exists
    const old_client = RegisteredClients.get(identifier);
    if (old_client) {
        // Expire the ping interval
        clearInterval(old_client.interval);
    }

    // Bind a new interval to ping the server
    let failures = 0;
    client.interval = setInterval(async () => {
        // Safely ping the server
        let success = false;
        try {
            success = await client.initialize();
        } catch (error) {}

        // If the ping failed, increment the failure count
        if (!success) failures++;

        // If the ping failed 10 times, expire the client
        if (failures >= 10) {
            clearInterval(client.interval);
            RegisteredClients.delete(identifier);

            // Update the clients in the file system
            await store_clients();
        }
    }, ping_interval);

    // Store the new client
    RegisteredClients.set(identifier, client);

    // Store the clients to the file system
    await store_clients();

    // Return the client
    return client;
}

/**
 * Stores the registered clients to the filesystem.
 * @returns {Promise<Object<string, BlackboardClient>>}
 */
export async function store_clients() {
    // Convert Map to object of cookies by identifier
    const clients = {};
    for (const [identifier, client] of RegisteredClients) clients[identifier] = client.cookies;

    // Store all registered clients to the filesystem
    await writeFile(process.env['CLIENTS_JSON'], JSON.stringify(clients, null, 2));

    // Return the clients
    return clients;
}

/**
 * Recovers registered clients from the filesystem from last runtime.
 *
 * @param {Boolean=} safe
 * @returns {Promise<void|Number|Error>}
 */
export async function recover_clients(safe = true) {
    try {
        // Read the clients from the filesystem
        const raw = await readFile(process.env['CLIENTS_JSON']);

        // Parse the clients
        const clients = JSON.parse(raw);

        // Register each client with the server
        for (const identifier in clients) await register_client(identifier, clients[identifier]);

        // Return the number of clients recovered
        return RegisteredClients.size;
    } catch (error) {
        if (!safe) throw error;
    }
}
