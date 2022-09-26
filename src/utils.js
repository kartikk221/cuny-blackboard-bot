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
 * @param {Object} embed_json
 * @returns {Object[]}
 */
export function spread_fields_over_embeds(embed_json) {
    const results = [];
    const { fields } = embed_json;
    if (Array.isArray(fields) && fields.length) {
        const max_fields = 25;
        const max_embeds = Math.ceil(fields.length / max_fields);
        for (let i = 0; i < max_embeds; i++) {
            const embed = { ...embed_json };
            embed.fields = fields.slice(i * max_fields, (i + 1) * max_fields);
            results.push(embed);
        }
    } else {
        results.push(embed_json);
    }
    return results;
}
