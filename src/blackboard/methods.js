import { readFile, writeFile } from 'fs/promises';
import { send_direct_message } from '../discord.js';
import { BlackboardClient, RegisteredClients } from './client.js';

/**
 * Returns a unique caller identifier for the given Discord interaction.
 *
 * @param {import('discord.js').Interaction} interaction
 * @returns {String}
 */
function interaction_to_identifier(interaction) {
    return `${interaction.guildId}:${interaction.user.id}`;
}

/**
 * @typedef {Object} Caller
 * @property {String} guild The Discord server/guild identifier
 * @property {String} user The Discord user identifier
 */

/**
 * Returns a caller object for the given identifier from a Discord interaction.
 *
 * @param {String} identifier
 * @returns {Caller}
 */
function identifier_to_caller(identifier) {
    const [guild, user] = identifier.split(':');
    return { guild, user };
}

/**
 * Resolves and returns a Blackboard client for the given Discord interaction.
 *
 * @param {import('discord.js').Interaction} interaction
 * @returns {BlackboardClient=}
 */
export function get_registered_client(interaction) {
    return RegisteredClients.get(interaction_to_identifier(interaction));
}

/**
 * Registers a new Blackboard API client with the given credentials from a Discord interaction.
 *
 * @param {import('discord.js').Interaction} interaction A Discord interaction object
 * @param {String} cookies The cookies to use for the client.
 * @returns {Promise<BlackboardClient|void>}
 */
export async function register_client(interaction, cookies) {
    // Convert the interaction into an identifier
    const identifier = interaction_to_identifier(interaction);

    // Create a new Blackboard client with the cookies
    const client = new BlackboardClient();

    // Initialize the client to validate the cookies
    let valid = false;
    try {
        valid = await client.import({ cookies });
    } catch (error) {}

    // Ensure the client is valid
    if (!valid) return;

    // Retrieve the old client if it exists
    const old_client = RegisteredClients.get(identifier);
    if (old_client) {
        // Expire the ping interval
        clearInterval(old_client.interval);
    }

    // Bind a "persist" event handler to store the clients when data is updated
    client.on('persist', store_clients);

    // Bind an "expire" event handler to the client
    client.once('expire', async () => {
        // Send a personal DM to the user
        await send_direct_message(
            {
                client: interaction.client,
                guild: interaction.guild || interaction.guildId,
                member: interaction.member || interaction.user.id,
            },
            `Your Blackboard account cookies have **expired**.\nPlease run the \`${process.env['COMMAND_PREFIX']} setup\` command to continue usage.`
        );

        // Remove the client from the registry
        RegisteredClients.delete(identifier);

        // Update the clients in the file system
        await store_clients();
    });

    // Store the new client
    RegisteredClients.set(identifier, client);

    // Store the clients to the file system
    await store_clients();

    // Return the client
    return client;
}

/**
 * Stores all registered clients to the filesystem for persistence.
 *
 * @returns {Promise<Object<string, BlackboardClient>>}
 */
export async function store_clients() {
    // Convert Map to object of cookies by identifier
    const clients = {};
    for (const [identifier, client] of RegisteredClients) clients[identifier] = client.export();

    // Store all registered clients to the filesystem
    await writeFile(process.env['CLIENTS_JSON'], JSON.stringify(clients, null, 2));

    // Return the clients
    return clients;
}

/**
 * Recovers registered clients from the filesystem from last persist.
 *
 * @param {import('discord.js').Client} bot The Discord bot client.
 * @param {Boolean=} safe Whether to recover clients safely.
 * @returns {Promise<void|Number|Error>}
 */
export async function recover_clients(bot, safe = true) {
    // Read the clients from the filesystem
    const raw = await readFile(process.env['CLIENTS_JSON']);

    // Parse the clients
    const clients = JSON.parse(raw);
    const count = Object.keys(clients).length;

    // Register each client with the server
    for (const identifier in clients) {
        // Create a new client
        const client = new BlackboardClient();

        // Bind a "persist" event handler to store the clients when data is updated
        client.on('persist', store_clients);

        // Bind an expire event handler to the client
        client.once('expire', async () => {
            // Retrieve the caller Discord guild and user identifiers
            const { guild, user } = identifier_to_caller(identifier);

            // Send a personal DM to the user with the guild name
            await send_direct_message(
                {
                    client: bot,
                    guild,
                    member: user,
                },
                `Your Blackboard account cookies have **expired**.\nPlease run the \`${process.env['COMMAND_PREFIX']} setup\` command to continue usage.`
            );

            // Remove the client from the registry
            RegisteredClients.delete(identifier);

            // Update the clients in the file system
            await store_clients();
        });

        // Import the client JSON
        let valid = false;
        try {
            valid = await client.import(clients[identifier]);
        } catch (error) {
            if (!safe) throw error;
        }

        // Determine if the client credentials are valid
        if (valid) {
            // Store the client in the registry
            RegisteredClients.set(identifier, client);
        } else {
            // Emit the expire event to alert the user of expired credentials
            client.emit('expire');
        }
    }

    // If we have a difference of laded and recovered clients, store the clients to expire the old ones
    if (count !== RegisteredClients.size) await store_clients();

    // Return the number of clients that were successfully recovered
    return RegisteredClients.size;
}
