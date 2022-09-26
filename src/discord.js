import { SlashCommandBuilder, REST as RestClient, Routes as RestRoutes } from 'discord.js';

// Import the slash commands and their handlers
import { build_setup_command, on_setup_command } from './commands/setup.js';
import { build_courses_command, on_courses_command } from './commands/courses.js';
import { build_assignments_command, on_assignments_command } from './commands/assignments.js';
import { build_summary_command, on_summary_command } from './commands/summary.js';

/**
 * Registers all slash commands with the Discord client globally.
 * @returns {Promise<void>}
 */
export async function register_slash_commands() {
    // Create a master command with all of the sub-commands
    const master_command_json = new SlashCommandBuilder()
        .setName(process.env['COMMAND_PREFIX'].replace('/', ''))
        .setDescription('Easily manage your CUNY Blackboard courses and assignments.')
        .setDMPermission(false)
        .addSubcommand(build_setup_command)
        .addSubcommand(build_courses_command)
        .addSubcommand(build_assignments_command)
        .addSubcommand(build_summary_command)
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

    // Set a timeout to defer the interaction if no response is sent within 2 seconds
    const defer_timeout = setTimeout(
        () =>
            !interaction.replied
                ? interaction.deferReply({
                      ephemeral: true,
                  })
                : null,
        2000
    );

    // Inject a respond method into the interaction to simplify the command handlers
    interaction.safe_reply = (response) => {
        // Always make the responses ephemeral
        response.ephemeral = true;

        // Ensure the interaction has not already been replied to
        if (interaction.replied) return;

        // Clear the defer timeout
        clearTimeout(defer_timeout);

        // Follow up with the interaction if it has been deferred
        if (interaction.deferred) return interaction.followUp(response);

        // Reply to the interaction
        return interaction.reply(response);
    };

    try {
        // Handle the sub-command based on the name
        switch (interaction.options.getSubcommand()) {
            case 'setup':
                return await on_setup_command(interaction);
            case 'courses':
                return await on_courses_command(interaction);
            case 'assignments':
                return await on_assignments_command(interaction);
            case 'summary':
                return await on_summary_command(interaction);
            default:
                // If the sub-command is not recognized, return an error message
                return interaction.safe_reply({
                    content: `The command \`${interaction.commandName}\` is not supported by this bot.`,
                    ephemeral: true,
                });
        }
    } catch (error) {
        // Determine if the error is a known error
        switch (error.message) {
            case 'NO_CLIENT':
                return await interaction.safe_reply({
                    ephemeral: true,
                    content: `Your Blackboard account has not been setup for this command yet. Please run the \`${process.env['COMMAND_PREFIX']} setup\` command to resolve this issue.`,
                });
            case 'NO_COURSE':
                return await interaction.safe_reply({
                    ephemeral: true,
                    content: `The course you have provided does not exist. Please run the \`${process.env['COMMAND_PREFIX']} courses\` command to view a list of your courses.`,
                });
            default:
                // If the error is not known, log it to the console
                console.error(error);
                return await interaction.safe_reply({
                    ephemeral: true,
                    content: `An unknown error occurred while handling this command. Please try again later or contact the bot developer if this issue persists.`,
                });
        }
    }
}

/**
 * Sends a DM to the owner of the client with the given identifier.
 *
 * @param {Object} deliverables Deliverable Discord.js objects to resolve and send a DM to the caller.
 * @param {import('discord.js').BaseClient} deliverables.client The Discord client to use to send the DM.
 * @param {(String|import('discord.js').Guild)} deliverables.guild The Discord guild to use to send the DM.
 * @param {(String|import('discord.js').GuildMember)} deliverables.member The Discord guild member to use to send the DM.
 * @param {String} message The text message DM to send to the user.
 * @returns {Promise<void>}
 */
export async function send_direct_message(deliverables, message) {
    // Destructure various deliverables
    let { client, guild, member } = deliverables;

    // Throw if the client is not a Discord client is not provided
    if (!client) throw new Error('A Discord client is required to send a DM.');

    // Attempt to resolve the member if it is not provided
    if (typeof member == 'string') {
        // Attempt to resolve the guild if it is not provided
        if (typeof guild == 'string') guild = await client.guilds.fetch(guild);

        // Attempt to resolve the member
        member = await guild.members.fetch(member);
    }

    // Send a DM to the user
    await member.send(message);
}
