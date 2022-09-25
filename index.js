// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

// Load dependencies
import { log } from './src/utils.js';
import { Client as DiscordClient } from 'discord.js';
import { recover_clients } from './src/blackboard/methods.js';
import { register_slash_commands, on_client_interaction } from './src/discord.js';

// Wrap the startup logic in an async function to allow for await statements
const start_time = Date.now();
(async () => {
    // Create a new Discord client to connect to the Discord API as a bot
    const client = new DiscordClient({
        intents: [],
    });

    // Bind a handler to the interactionCreate event to handle slash commands
    client.on('interactionCreate', on_client_interaction);

    // Bind a handler to the ready event to register slash commands
    client.once('ready', async () => {
        // Register all slash commands with Discord
        await register_slash_commands();
        log('COMMANDS', `Registered slash commands in ${Date.now() - start_time}ms`);

        // Recover all clients from the database
        const count = await recover_clients(client, true);
        if (count)
            log('RECOVERY', `Successfully recovered ${count} Blackboard client(s) after ${Date.now() - start_time}ms`);

        // Log that the bot is ready
        log(
            'INVITE',
            `Invite the bot to your server using the following link:\nhttps://discord.com/oauth2/authorize?client_id=${process.env['DISCORD_APPLICATION_ID']}&scope=bot&permissions=2147483648`
        );
    });

    // Login to Discord with the bot token
    await client.login(process.env['DISCORD_BOT_TOKEN']);
    log('BOT', `Successfully logged in to Discord as ${client.user.tag} after ${Date.now() - start_time}ms`);
})();
