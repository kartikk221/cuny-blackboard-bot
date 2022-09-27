import fetch from 'node-fetch';
import makeFetchCookie from 'fetch-cookie';
import { BLACKBOARD_URL_BASE, DEFAULT_USER_AGENT } from './client.js';

/**
 * Performs a Blackboard login to generate session cookies.
 *
 * @param {String} username
 * @param {String} password
 * @returns {Promise<String>} The session cookies in header format
 */
export async function perform_blackboard_login(username, password) {
    // Create a new fetch instance with cookie support
    const cookie_jar = new makeFetchCookie.toughCookie.CookieJar();
    const fetch_with_cookies = makeFetchCookie(fetch, cookie_jar);

    // Fetch the Blackboard home page which will redirect to the login page
    const login_response = await fetch_with_cookies(BLACKBOARD_URL_BASE, {
        method: 'GET',
        headers: {
            'user-agent': DEFAULT_USER_AGENT,
        },
    });

    // Make a POST request to the login endpoint with the credentials
    const endpoint = `${new URL(login_response.url).origin}/oam/server/auth_cred_submit`;
    const endpoint_response = await fetch_with_cookies(endpoint, {
        method: 'POST',
        headers: {
            'user-agent': DEFAULT_USER_AGENT,
            'content-type': 'application/x-www-form-urlencoded',
        },
        body: `usernameH=${encodeURIComponent(username)}&username=${encodeURIComponent(
            username.split('@')[0].toLowerCase()
        )}&password=${password}&submit=`,
    });

    // If we have arrived on the blackboard home page, we have successfully logged in
    if (endpoint_response.url.startsWith(BLACKBOARD_URL_BASE)) {
        // Return the session cookies in header format
        const cookies = await cookie_jar.getCookies(BLACKBOARD_URL_BASE, {
            allPaths: true,
        });

        // Return the session cookies in header format
        return cookies.map((cookie) => `${cookie.key}=${cookie.value}`).join('; ');
    } else {
        throw new Error('INVALID_CREDENTIALS');
    }
}
