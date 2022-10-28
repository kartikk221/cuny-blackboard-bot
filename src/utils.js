/**
 * Returns a Promise that resolves after the given number of milliseconds.
 *
 * @param {Number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Logs specified message to console in an organized log message
 *
 * @param {String} category
 * @param {String} message
 */
export function log(category = 'SYSTEM', message) {
    let dt = new Date();
    let timeStamp = dt.toLocaleString([], { hour12: true, timeZone: 'America/New_York' }).replace(', ', ' ').split(' ');
    timeStamp[1] += ':' + dt.getMilliseconds().toString().padStart(3, '0') + 'ms';
    timeStamp = timeStamp.join(' ');
    console.log(`[${timeStamp}][${category}] ${message}`);
}

/**
 * Performs an operation with retries on failure.
 *
 * @param {Number} amount
 * @param {Number} delay
 * @param {Function} operation
 * @param {Function=} onError
 * @returns {Promise}
 */
export async function with_retries(amount, delay, operation, onError) {
    let result;
    try {
        const output = operation();
        if (output instanceof Promise) result = await output;
    } catch (error) {
        if (onError) onError(error);
        if (amount > 0) {
            amount--;
            await sleep(delay);
            return await with_retries(amount, delay, operation, onError);
        } else {
            throw error;
        }
    }

    return result;
}

/**
 * Spreads fields from provided embed JSON over multiple embeds if the numer of fields exceeds the 25 field limit per embed.
 * @param {Object} embed
 * @returns {Object[]}
 */
export function spread_fields_over_embeds(embed) {
    const results = [];
    if (Array.isArray(embed.fields) && embed.fields.length) {
        // Define limits for each embed
        const max_fields = 25;
        const max_length = 6000;

        // Begin splitting the embed's fields into multiple embed containers
        let container = { ...embed };
        container.fields = [];
        let container_fields = 0;
        let container_length = JSON.stringify(container).length;
        for (let i = 0; i < embed.fields.length; i++) {
            // Add the field to the current container
            container.fields.push(embed.fields[i]);
            container_fields++;
            container_length += JSON.stringify(embed.fields[i]).length;

            // If the container is full, create a new one
            if (container_fields >= max_fields || container_length >= max_length) {
                results.push(container);
                container = { ...embed };
                container.fields = [];
                container_fields = 0;
                container_length = JSON.stringify(container).length;
            }
        }

        // Push container to results if we have no results aka. no limits were reached
        if (!results.length) results.push(container);
    } else {
        results.push(embed);
    }

    return results;
}
