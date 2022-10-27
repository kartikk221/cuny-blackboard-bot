import { readFile, writeFile } from 'fs/promises';
import { send_direct_message } from '../discord.js';
import { BlackboardClient, RegisteredClients } from './client.js';

/**
 * Returns a unique caller identifier for the given Discord interaction.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
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
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {BlackboardClient=}
 */
export function get_registered_client(interaction) {
    return RegisteredClients.get(interaction_to_identifier(interaction));
}

/**
 * Registers a new Blackboard API client with the given credentials from a Discord interaction.
 *
 * @param {import('discord.js').Interaction} interaction A Discord interaction object
 * @param {String} token The session token for the Blackboard API
 * @returns {Promise<BlackboardClient|void>}
 */
export async function register_client(interaction, token) {
    // Convert the interaction into an identifier
    const identifier = interaction_to_identifier(interaction);

    // Re-use an existing client if one exists or create a new one
    const client = get_registered_client(interaction) || new BlackboardClient();

    // Initialize the client to validate the cookies
    let valid = false;
    try {
        valid = await client.import({ token });
    } catch (error) {
        console.error(error);
    }
    console.log('valid', valid);

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

    // Bind a "dispatch" event handler to dispatch messages to the user
    client.on('dispatch', async (guild_id, channel_id, content, embeds) => {
        // Retrieve the guild from the interaction client
        const guild = await interaction.client.guilds.fetch(guild_id);
        if (!guild) return;

        // Retrieve the channel from the guild
        const channel = guild.channels.cache.get(channel_id);
        if (!channel) return;

        // Send the content and embeds to the channel
        return await channel.send({ content: content ? `<@${interaction.user.id}> ${content}` : undefined, embeds });
    });

    // Bind an "expire" event handler to the client
    client.once('expired', async () => {
        console.log('expired', client);
        // Send a DM to the user to notify them that the client has expired
        send_direct_message(
            {
                client: interaction.client,
                guild: interaction.guild || interaction.guildId,
                member: interaction.member || interaction.user.id,
            },
            `Your Blackboard account cookies have **expired**.\nPlease run the \`${process.env['COMMAND_PREFIX']} login\` command to continue usage.`
        );

        // Update the clients json
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
    for (const [identifier, client] of RegisteredClients) clients[identifier] = await client.export();

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

    // Register each client with the server
    for (const identifier in clients) {
        // Create a new client
        const client = new BlackboardClient();

        // Store the client in the registry
        RegisteredClients.set(identifier, client);

        // Bind a "persist" event handler to store the clients when data is updated
        client.on('persist', store_clients);

        // Bind a "dispatch" event handler to dispatch messages to the user
        client.on('dispatch', async (guild_id, channel_id, content, embeds) => {
            // Retrieve the guild from the interaction client
            const guild = await bot.guilds.fetch(guild_id);
            if (!guild) return;

            // Retrieve the channel from the guild
            const channel = await guild.channels.fetch(channel_id);
            if (!channel) return;

            // Retrieve the caller from the identifier
            const { user } = identifier_to_caller(identifier);

            // Send the embeds to the channel
            return await channel.send({ content: content ? `<@${user}> ${content}` : undefined, embeds });
        });

        // Bind an expire event handler to the client
        client.once('expired', async () => {
            // Retrieve the caller Discord guild and user identifiers
            const { guild, user } = identifier_to_caller(identifier);

            // Send a personal DM to the user with the guild name
            await send_direct_message(
                {
                    client: bot,
                    guild,
                    member: user,
                },
                `Your Blackboard account cookies have **expired**.\nPlease run the \`${process.env['COMMAND_PREFIX']} login\` command to continue usage.`
            );

            // Update the clients json
            await store_clients();
        });

        // Import the client JSON
        let valid = false;
        try {
            valid = await client.import(clients[identifier]);
        } catch (error) {
            console.error(error);
            if (!safe) throw error;
        }

        // Emit the "expired" event to send a DM to the user
        if (!valid) client.emit('expired');
    }

    // Return the number of clients that were successfully recovered
    return RegisteredClients.size;
}
