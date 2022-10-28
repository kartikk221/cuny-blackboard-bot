import * as whenTime from 'when-time';
import { EventEmitter } from 'events';
import { sleep, with_retries } from '../utils.js';
import { generate_summary_embeds } from '../commands/summary.js';

export const MAX_KEEP_ALIVE_RETRIES = 5;

/**
 * The cache map that stores all available registered Blackboard client instances.
 * @type {Map<string, BlackboardClient>}
 */
export const RegisteredClients = new Map();

// This class will act as an API client for each user
export class BlackboardClient extends EventEmitter {
    #keep_alive;
    #schedules = new Map();
    #client = {
        name: null,
        token: null,
        ignore: {},
        alerts: {},
    };

    /**
     * @typedef {Object} Client
     * @property {String=} name The name of the current authenticated user.
     * @property {String} token The authentication token for the current user.
     * @property {Object<string,any>} alerts The alert settings for the current authenticated user.
     * @property {Object<string,any>} ignore The ignore settings for the current authenticated user.
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
        if (this.#client.token === null) throw new Error('NO_CLIENT');
    }

    /**
     * Performs an authenticated API request to the Blackboard API.
     *
     * @param {String} path
     * @param {RequestInit} options
     * @returns {Promise<Response>}
     */
    async _api_request(path, options = {}) {
        // Ensure the client is authenticated
        this._ensure_authenticated();

        // Modify the options headers to include the authentication token
        options.headers = Object.assign({}, options.headers, {
            authorization: this.#client.token,
        });

        // Perform the request
        const response = await fetch(`${process.env['BLACKBOARD_API_BASE']}${path}`, options);

        // Return the response
        return response;
    }

    /**
     * Imports or initiializes a new Blackboard client.
     *
     * @param {Client} client
     * @param {Number=} retries The number of times to retry the authentication process.
     * @param {Number=} delay The delay in milliseconds between each retry.
     * @returns {Promise<Boolean>}
     */
    async import(client, retries = 5, delay = 2500) {
        // Create a shallow copy of the client object to prevent mutation of the original object
        client = Object.assign({}, client);

        // Initialize token to null if it is not defined
        if (!client.token) client.token = null;

        // Merge the client data with the internal client data
        this.#client = Object.assign(this.#client, client);

        // Attempt to safely parse the user name to validate the session token
        let is_logged_in = false;
        try {
            // Perform a request to the Blackboard API "me" endpoint to validate the token
            const reference = this;
            const { full_name } = await with_retries(retries, delay, async () => {
                // Make a GET request to the Blackboard API "me" endpoint
                const response = await reference._api_request('/me');

                // Ensure the response is valid
                if (!response.ok) throw new Error(`INVALID_HTTP_RESPONSE_${response.status}`);

                // Parse the response as JSON
                return await response.json();
            });

            // Set the client name to the full name of the user
            is_logged_in = true;
            this.#client.name = full_name;
        } catch (error) {
            console.error(error);
        }

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
                    // Make a request to refresh the token
                    const response = await this._api_request('/login/refresh', {
                        method: 'POST',
                    });

                    // Ensure the response is valid
                    if (!response.ok) throw new Error(`INVALID_HTTP_RESPONSE_${response.status}`);

                    // Parse the response as JSON
                    const { token } = await response.json();

                    // Update the client token
                    this.#client.token = token;

                    // Set the alive flag to true
                    alive = true;

                    // Emit an event to persist the new token
                    this.emit('persist');
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
                        this.#client.token = null;
                        this.emit('expired');
                    }
                } else {
                    // Reset the failure count
                    failures = 0;
                }
            }, 1000 * 60 * 15); // Keep Alive every 15 minutes
        } else {
            this.#client.token = null;
        }

        // Return a Boolean based on a valid user name was found
        return is_logged_in;
    }

    /**
     * Exports the current client to a JSON object.
     * @returns {Promise<Client>}
     */
    async export() {
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
     * @property {String} url The Blackboard course URL.
     * @property {String} name The course name.
     * @property {String} code The course institution code.
     * @property {null|String} description The course description.
     * @property {null|{ id: string, name: string }} term The course term information.
     * @property {Number} enrolled_at The timestamp of when the user enrolled in the course.
     * @property {Number} accessed_at The timestamp of when the user last accessed the course.
     * @property {Number} updated_at The timestamp of when the course was last updated.
     */

    /**
     * Returns all of the classes the user is enrolled in.
     * Note! This method caches the courses in the returned Map.
     * You may clear the cache by calling the `Map.clear()` method on the returned Map.
     * @param {Number=} max_age The maximum age of each of class in milliseconds. Defaults to `6 months` max age.
     * @param {Number=} retries The number of times to retry the fetch process.
     * @param {Number=} delay The delay in milliseconds between each retry.
     * @returns {Promise<Object<string, Course>>}
     */
    async get_all_courses(max_age = 1000 * 60 * 60 * 24 * 30 * 6, retries = 5, delay = 1000) {
        // Ensure client has been authenticated
        this._ensure_authenticated();

        // Fetch the courses from the API
        let courses = await with_retries(retries, delay, async () => {
            // Fetch the courses from the API
            const response = await this._api_request('/courses');

            // Ensure the response is valid
            if (!response.ok) throw new Error(`INVALID_HTTP_RESPONSE_${response.status}`);

            // Parse the response as JSON
            return await response.json();
        });

        // Sort the courses by the last modified timestamps
        courses.sort((a, b) => b.updated_at - a.updated_at);

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
     * @typedef {('NOT_AVAILABLE'|'UPCOMING'|'SUBMITTED'|'PAST_DUE'|'GRADED')} AssignmentStatus
     */

    /**
     * @typedef {Object} SimpleAssignment
     * @property {String} id The ID of the assignment.
     * @property {String} name The name of the assignment.
     * @property {AssignmentStatus} status The status of the assignment.
     * @property {String} category The category of the assignment.
     * @property {Number} deadline_at The timestamp of when the assignment is due.
     * @property {{ score: null | number, possible: null | number }} grade The grade information for the assignment.
     */

    /**
     * @typedef {Object} AssignmentAttempt
     * @property {String} id The ID of the assignment attempt.
     * @property {Number} created_at The timestamp of when the assignment attempt was created.
     * @property {{ id: null|string, body: null|string, size: null|number }} submission The submission information for the assignment attempt.
     * @property {{ score: null|number, feedback: null|number }} grade The grade information for the assignment attempt.
     */

    /**
     * @typedef {Object} AssignmentDetails
     * @property {String=} description The description of the assignment.
     * @property {Number=} created_at The timestamp of when the assignment was created.
     * @property {Number=} updated_at The timestamp of when the assignment was last updated.
     * @property {Array<AssignmentAttempt>=} attempts The attempts for the assignment.
     */

    /**
     * Returns all assignments for a given course ID.
     * You may retrieve full details for an assignment by specifying the full flag.
     * Note! You may use the `get_all_courses()` method to get all course IDs.
     *
     * @param {Course} course The course to get assignments for.
     * @param {Object} options The options for fetching assignments.
     * @param {AssignmentStatus=} options.status The status of the assignments to filter by.
     * @param {Number=} options.min_deadline_at The minimum deadline timestamp of the assignments to filter by.
     * @param {Number=} options.max_deadline_at The maximum deadline timestamp of the assignments to filter by.
     * @param {Number=} options.retries The number of times to retry the fetch process.
     * @param {Number=} options.delay The delay in milliseconds between each retry.
     * @returns {Promise<Array<SimpleAssignment & AssignmentDetails>>}
     */
    async get_all_assignments(course, options) {
        // Ensure client has been authenticated
        this._ensure_authenticated();

        // Destructure the options
        const { status, min_deadline_at = 0, max_deadline_at = Infinity, retries = 5, delay = 1000 } = options || {};

        // Fetch the assignments from the API
        let assignments = await with_retries(retries, delay, async () => {
            // Fetch the assignments from the API
            const response = await this._api_request(`/courses/${course.id}/assignments`);

            // Ensure the response is valid
            if (!response.ok) throw new Error(`INVALID_HTTP_RESPONSE_${response.status}`);

            // Parse the response as JSON
            return await response.json();
        });

        // Filter the assignments by the deadline timestamp range
        assignments = assignments.filter(
            ({ deadline_at }) => deadline_at >= min_deadline_at && deadline_at <= max_deadline_at
        );

        // Retrieve further details for each assignment if neccessary up to 5 at a time
        const concurrent_limit = 5;
        const concurrent_items = [];
        const requires_specifics = !(status && !['SUBMITTED', 'PAST_DUE'].includes(status));
        for (let i = 0; i < assignments.length; i++) {
            const assignment = assignments[i];

            // Determine if the assignment is already graded
            if (assignment.grade.score !== null) {
                assignment.status = 'GRADED';
            } else if (requires_specifics && assignment.deadline_at < Date.now()) {
                // Begin fetching the specific details for the assignment
                const promise = this.get_specific_assignment(course, assignment);

                // Bind the resolver to override the assignment
                promise.then((specific) => (assignments[i] = specific));

                // Add the promise to the concurrent items
                concurrent_items.push(promise);

                // Wait for the concurrent items to finish if the limit has been reached
                if (concurrent_items.length >= concurrent_limit) {
                    await Promise.all(concurrent_items);

                    // Flush the concurrent items
                    concurrent_items.length = 0;
                }
            } else {
                // Mark the assignment as upcoming
                // While this is not fully true, it is the best we can do without fetching further details
                assignment.status = 'UPCOMING';
            }
        }

        // Wait for the concurrent items to finish if there are any remaining
        if (concurrent_items.length) await Promise.all(concurrent_items);

        // Return the simple assignments
        return assignments;
    }

    /**
     * Returns specific details about an assignment for a given course/assignment.
     * Note! You may use the `get_all_courses()` and `get_all_assignments()` methods to get all course IDs and assignment IDs.
     *
     * @param {Course} course The course to get the detailed assignment for.
     * @param {SimpleAssignment} assignment The assignment to get the detailed assignment for.
     * @param {Number=} retries The number of times to retry the fetch process.
     * @param {Number=} delay The delay in milliseconds between each retry.
     * @returns {Promise<SimpleAssignment & AssignmentDetails>}
     */
    async get_specific_assignment(course, assignment, retries = 5, delay = 2500) {
        // Ensure client has been authenticated
        this._ensure_authenticated();

        // Fetch the assignment details from the API and merge/return it with original simple assignment
        return {
            ...assignment,
            ...(await with_retries(retries, delay, async () => {
                // Fetch the assignments from the API
                const response = await this._api_request(`/courses/${course.id}/assignments/${assignment.id}`);

                // Determine if we are not allowed to view the assignment aka. UPCOMING
                if (response.status === 404 || response.status === 403) return { status: 'NOT_AVAILABLE' };

                // Ensure the response is valid
                if (!response.ok) throw new Error(`INVALID_HTTP_RESPONSE_${response.status}`);

                // Parse the response as JSON
                const details = await response.json();

                // Determine the status of the assignment
                details.status = 'UPCOMING';
                if (details.attempts.length) {
                    // Set assignment status to SUBMITTED if the last attempt has a submission
                    details.status = 'SUBMITTED';

                    // Determine if the last attempt has a grade
                    if (details.attempts[0].grade.score !== null) details.status = 'GRADED';
                } else if (details.deadline_at < Date.now()) {
                    // Set assignment status to PAST_DUE if the deadline has passed
                    details.status = 'PAST_DUE';
                }

                return details;
            })),
        };
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
     * Returns the user name of the current authenticated user.
     * @returns {String}
     */
    get name() {
        return this.#client.name;
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
