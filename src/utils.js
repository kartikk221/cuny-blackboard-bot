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
