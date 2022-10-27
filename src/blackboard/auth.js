/**
 * Performs a Blackboard login to generate session token.
 *
 * @param {String} username
 * @param {String} password
 * @returns {Promise<String>} The session token for Blackboard API
 */
export async function perform_blackboard_login(username, password) {
    // Make fetch request to generate a session token
    const response = await fetch(`${process.env['BLACKBOARD_API_BASE']}/login`, {
        method: 'POST',
        body: JSON.stringify({
            username,
            password,
        }),
    });

    // Try to parse the response as JSON
    try {
        // Retrieve the token from the response
        const { token } = await response.json();

        // Return the token if it is a valid string
        if (typeof token === 'string') return token;

        // Otherwise, throw an error
        throw new Error('NO_TOKEN_RECEIVED');
    } catch (error) {
        throw new Error('INVALID_CREDENTIALS');
    }
}
