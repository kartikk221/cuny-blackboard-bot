import dotenv from 'dotenv';
import { log } from './src/utils.js';
import { recover_clients } from './src/blackboard.js';
import { Client as DiscordClient } from 'discord.js';
import { register_slash_commands, on_client_interaction } from './src/discord.js';

// Load environment variables from .env file
dotenv.config();

// Wrap the startup logic in an async function
(async () => {
    // Create a new Discord client
    const start_time = Date.now();
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
        const count = await recover_clients(true);
        if (count)
            log('RECOVERY', `Successfully recovered ${count} Blackboard client(s) in ${Date.now() - start_time}ms`);

        // Log that the bot is ready
        log(
            'INVITE',
            `Invite the bot to your server using the following link:\nhttps://discord.com/oauth2/authorize?client_id=${process.env['DISCORD_APPLICATION_ID']}&scope=bot&permissions=2147483648`
        );
    });

    // Login to Discord with the bot token
    await client.login(process.env['DISCORD_BOT_TOKEN']);
    log('BOT', `Successfully logged in to Discord as ${client.user.tag} in ${Date.now() - start_time}ms`);
})();
