import fetch from 'node-fetch';
import makeFetchCookie from 'fetch-cookie';
import * as whenTime from 'when-time';
import * as cheero from 'cheerio';
import { EventEmitter } from 'events';
import { sleep, with_retries } from '../utils.js';
import { generate_summary_embeds } from '../commands/summary.js';

export const MAX_KEEP_ALIVE_RETRIES = 5;
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
    #fetch;
    #cookie_jar;
    #keep_alive;
    #base = BLACKBOARD_URL_BASE;
    #user_agent = DEFAULT_USER_AGENT;
    #schedules = new Map();
    #client = {
        name: null,
        cookies: null,
        ignore: {},
        alerts: {},
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

        // Create a new cookie jar
        this.#cookie_jar = new makeFetchCookie.toughCookie.CookieJar();

        // Create a new fetch instance with the cookie jar
        this.#fetch = makeFetchCookie(fetch, this.#cookie_jar);
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
     * Returns the most recent cookies for this client.
     *
     * @private
     * @returns {Promise<String>}
     */
    async _get_cookies() {
        // Retrieve the cookies from the cookie jar
        const cookies = await this.#cookie_jar.getCookies(this.#base);

        // Return the cookies as a string
        return cookies.map((cookie) => `${cookie.key}=${cookie.value}`).join('; ');
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
        if (!client.ping) client = Object.assign({}, client);

        // Fill the client cookies with an empty string if it is null
        client.cookies = client.cookies || '';

        // If this is not a ping import, parse the string cookies into the cookie jar
        if (!client.ping)
            client.cookies.split(';').forEach((cookie) => {
                const [key, value = ''] = cookie.split('=');
                if (key) this.#cookie_jar.setCookie(`${key}=${value}`, this.#base);
            });

        // Attempt to safely parse the user name to validate the cookies session
        let is_logged_in = false;
        try {
            // Parse the response as text HTML
            const text = await with_retries(retries, delay, async () => {
                // Make the fetch request to the Blackboard homepage
                const response = await this.#fetch(this.#base, {
                    method: 'GET',
                    headers: {
                        'user-agent': this.#user_agent,
                    },
                });

                // Ensure the response status is 200
                if (response.status !== 200) throw new Error('Invalid response status code.');

                // Ensure the response url is the Blackboard homepage
                if (!response.url.startsWith(this.#base)) throw new Error('Invalid response URL.');

                // Return the response
                return await response.text();
            });

            // Cache the cheerio HTML DOM object
            const $ = cheero.load(text);

            // Strip the nav link to only contain the user name
            $('#global-nav-link').children().remove();

            // Parse the user name
            client.name = $('#global-nav-link').text().trim();

            // Determine if the session is valid based on a valid client name
            is_logged_in = client.name.length > 0;
        } catch (error) {
            console.error(error);
        }

        // Ensure this is not a ping import call as we do not want to overwrite the client data in this case
        if (!client.ping) {
            // Merge the client data with the internal client data
            this.#client = Object.assign(this.#client, client);

            // Perform keep-alive if the client is logged in
            if (is_logged_in) {
                // Re-schedule all alerts to account for the new imported alerts
                this._reschedule_alerts();

                // Clear the old keep alive interval if it exists
                if (this.#keep_alive) clearInterval(this.#keep_alive);

                // Start a new keep alive interval
                let failures = 0;
                this.#keep_alive = setInterval(async () => {
                    // Perform an import with just the cookies to keep the session alive
                    let alive = false;
                    try {
                        alive = await this.import({ cookies: await this._get_cookies(), ping: true });
                    } catch (error) {
                        console.error(error);
                    }

                    // Expire the cookies and emit 'expired' event if the session is no longer alive
                    if (!alive) {
                        // Increment the failure count
                        failures++;

                        // Expire the client if the failure count is greater than the max retries
                        if (failures >= MAX_KEEP_ALIVE_RETRIES) {
                            clearInterval(this.#keep_alive);
                            this.#cookie_jar.removeAllCookies();
                            this.#client.cookies = null;
                            this.emit('expired');
                        }
                    }
                }, 1000 * 60 * 5); // Keep Alive every 5 minutes
            } else {
                // Clear the cookies value if the user is not logged in
                this.#cookie_jar.removeAllCookies();
                this.#client.cookies = null;
            }
        }

        // Return a Boolean based on a valid user name was found
        return is_logged_in;
    }

    /**
     * Exports the current client to a JSON object.
     * @returns {Promise<Client>}
     */
    async export() {
        // Parse and update the client cookies with the current cookie jar
        this.#client.cookies = await this._get_cookies();

        // Return a shallow copy of the client to allow for the caller to modify the object without affecting the internal client data
        return Object.assign({}, this.#client);
    }

    /**
     * Returns whether or not the specified type of data is being ignored for the given identifier.
     *
     * @param {String} type
     * @param {String} identifier
     * @returns {Boolean} Returns `true` if the data is being ignored, otherwise `false`.
     */
    ignored(type, identifier) {
        // Retrieve the ignored values for this type
        const ignored = this.#client.ignore[type];
        if (ignored) return ignored.includes(identifier);
    }

    /**
     * Ignore the specified type of data for this client.
     *
     * @param {String} type
     * @param {String} identifier
     * @returns {Boolean} Returns `true` if the data was ignored, `false` if the data was already being ignored.
     */
    ignore(type, identifier) {
        // Determine if an Array already exists for the type
        if (!this.#client.ignore[type]) this.#client.ignore[type] = [];

        // Add the identifier to the ignore list if it does not already exist
        if (!this.#client.ignore[type].includes(identifier)) {
            // Add the identifier to the ignore list
            this.#client.ignore[type].push(identifier);

            // Emit a 'persist' event
            this.emit('persist');
            return true;
        } else {
            return false;
        }
    }

    /**
     * Un-Ignore the specified type of data for this client.
     *
     * @param {String} type
     * @param {String} identifier
     * @returns {Boolean} Returns `true` if the data was un-ignored, `false` if the data was already not being being ignored.
     */
    unignore(type, identifier) {
        // Determine if an Array already exists for the type
        if (!this.#client.ignore[type]) this.#client.ignore[type] = [];

        // Remove the identifier from the ignore list if it exists
        const index = this.#client.ignore[type].indexOf(identifier);
        if (index !== -1) {
            // Remove the identifier from the ignore list
            this.#client.ignore[type].splice(index, 1);

            // Delete the ignore list if it is empty
            if (this.#client.ignore[type].length === 0) delete this.#client.ignore[type];

            // Emit a 'persist' event
            this.emit('persist');
            return true;
        } else {
            return false;
        }
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
            // Store a shallow copy of the cached courses to prevent the cache from being modified by caller
            courses = Object.assign([], cache.value);
        } else {
            // Fetch the grades stream viewer POST URL as JSON data
            const json = await with_retries(retries, delay, async () => {
                // Make fetch request to the Blackboard API endpoint
                const response = await this.#fetch(`${this.#base}/webapps/streamViewer/streamViewer`, {
                    method: 'POST',
                    headers: {
                        'user-agent': this.#user_agent,
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
            // Filter out courses that are older than the max age
            if (course.updated_at + max_age < Date.now()) return;

            // Add the course to the object
            filtered[`#${index + 1}`] = course;
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
            const response = await this.#fetch(`${this.#base}${course.urls.grades}`, {
                method: 'GET',
                headers: {
                    'user-agent': this.#user_agent,
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
     * @typedef {Object} SummaryAlert
     * @property {String} summary The summary type of the alert.
     * @property {String} guild The Discord guild ID of the alert.
     * @property {String} channel The Discord channel ID associated with the alert.
     * @property {('DAILY'|'WEEKLY')} interval The interval in milliseconds to dispatch alerts repeatedly.
     * @property {Number} hour_of_day The hour of the day to dispatch alerts at repeatedly (24 Hour Format).
     * @property {Number} max_courses_age The maximum age in "number of months" to filter out courses for the alert.
     */

    /**
     * Creates or updates a summary alert.
     *
     * @param {SummaryAlert} alert The alert to create.
     * @returns {Boolean} Returns `true` if the alert was created or `false` if the alert was updated.
     */
    deploy_alert(alert) {
        // Determine a unique identifier for this alert based on the channel/summary combination
        const identifier = `${alert.channel}:${alert.summary}`;

        // Determine if the alert will be created
        const created = this.#client.alerts[identifier] === undefined;

        // Set the alert in the alerts object
        this.#client.alerts[identifier] = alert;

        // Re-schedule all alerts to ensure they are up to date
        this._reschedule_alerts();

        // Emit the "persist" event to persist the alerts object to disk
        this.emit('persist');

        // Return whether or not the alert already existed
        return created;
    }

    /**
     * Deletes an alert if it exists.
     *
     * @param {String} channel The Discord channel ID associated with the alert.
     * @param {String} summary The summary type of the alert.
     * @returns {Boolean} Whether or not a alert was deleted.
     */
    delete_alert(channel, summary) {
        // Determine a unique identifier for this alert based on the channel/summary combination
        const identifier = `${channel}:${summary}`;

        // Determine if the alert exists
        const exists = this.#client.alerts[identifier] !== undefined;

        // Delete the alert from the alerts object
        delete this.#client.alerts[identifier];

        // Re-schedule all alerts to ensure they are up to date
        this._reschedule_alerts();

        // Emit the "persist" event to persist the alerts object to disk
        if (exists) this.emit('persist');

        // Return whether or not the alert existed
        return exists;
    }

    /**
     * Purges old schedules and re-schedules all alerts to be dispatched.
     * @private
     */
    _reschedule_alerts() {
        // Destroy all existing schedules
        this.#schedules.forEach((schedule) => schedule.cancel());

        // Clear the schedules map to release old schedules
        this.#schedules.clear();

        // Iterate over all alerts and schedule them to be dispatched
        const alerts = this.#client.alerts;
        for (const identifier in alerts) {
            // Retrieve the alert
            const alert = alerts[identifier];

            // Determine a repetition interval string for the alert
            let every;
            switch (alert.interval) {
                case 'DAILY':
                    every = '1 Day';
                    break;
                case 'WEEKLY':
                    every = '1 Week';
                    break;
            }

            // Schedule a time task to dispatch the alert
            const schedule = whenTime
                .isEqualTo(`${alert.hour_of_day}:00`)
                .do(async () => {
                    // Retrieve a summary embed for the alert
                    const embeds = await generate_summary_embeds(
                        this,
                        alert.summary,
                        1000 * 60 * 60 * 24 * 30 * alert.max_courses_age
                    );

                    // Determine if the summary embed has at least one field aka. assignments
                    const description = embeds[0]?.description;
                    const first_embed_fields = embeds[0]?.fields || [];
                    if (first_embed_fields.length) {
                        // Dispatch an event with the destination guild, channel and summary embed
                        this.emit('dispatch', alert.guild, alert.channel, description, embeds);
                    }
                })
                .repeat(Infinity)
                .every(every)
                .inTimezone('America/New_York');

            // Add the schedule to the schedules map
            this.#schedules.set(identifier, schedule);
        }
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
     * Returns the user agent used for requests.
     * @returns {String}
     */
    get user_agent() {
        return this.#user_agent;
    }

    /**
     * Returns the current alerts for the authenticated user.
     * @returns {Object<string, SummaryAlert>}
     */
    get alerts() {
        // Return a copy of the alerts object to prevent modification of the original
        return Object.assign({}, this.#client.alerts);
    }
}
