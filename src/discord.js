import { SlashCommandBuilder, REST as RestClient, Routes as RestRoutes } from 'discord.js';

// Import the slash commands and their handlers
import { build_setup_command, on_setup_command } from './commands/setup.js';
import { build_courses_command, on_courses_command } from './commands/courses.js';

/**
 * Registers all slash commands with the Discord client globally.
 * @returns {Promise<void>}
 */
export async function register_slash_commands() {
    // Create a master command with all of the sub-commands
    const master_command_json = new SlashCommandBuilder()
        .setName(process.env['COMMAND_PREFIX'].replace('/', ''))
        .setDescription('Easily manage the CUNY Blackboard Discord bot.')
        .addSubcommand(build_setup_command)
        .addSubcommand(build_courses_command)
        .toJSON();

    // Create a new Discord REST client to make API requests to Discord
    const client = new RestClient({ version: '10' }).setToken(process.env['DISCORD_BOT_TOKEN']);

    // Register all slash commands with Discord
    await client.put(RestRoutes.applicationCommands(process.env['DISCORD_APPLICATION_ID']), {
        body: [master_command_json],
    });
}

/**
 * Handles an interactionCreate event from the Discord client.
 *
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<void>}
 */
export async function on_client_interaction(interaction) {
    // Ensure the interaction is a text input command from a guild
    if (!interaction.isCommand() || !interaction.guild) return;

    // Ensure the command name matches the prefix
    if (interaction.commandName !== process.env['COMMAND_PREFIX'].replace('/', '')) return;

    // Handle the sub-command based on the name
    switch (interaction.options.getSubcommand()) {
        case 'setup':
            return await on_setup_command(interaction);
        case 'courses':
            return await on_courses_command(interaction);
        default:
            // If the sub-command is not recognized, return an error message
            return interaction.reply({
                content: `The command \`${interaction.commandName}\` is not supported by this bot.`,
                ephemeral: true,
            });
    }
}
