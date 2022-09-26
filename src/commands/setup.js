import { register_client } from '../blackboard/methods.js';

/**
 * Builds and returns the `setup` command.
 * @param {import('discord.js').SlashCommandBuilder} builder
 * @returns {import('discord.js').SlashCommandBuilder}
 */
export function build_setup_command(builder) {
    return builder
        .setName('setup')
        .setDescription('Setup your Blackboard account with the bot using session cookies.')
        .addStringOption((option) =>
            option
                .setName('cookies')
                .setDescription(
                    'Enter your blackboard session cookies in key value format. (Example: key1=value1; key2=value2...)'
                )
                .setRequired(true)
        );
}

/**
 * Handles interactions for the  `setup` command.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<void>}
 */
export async function on_setup_command(interaction) {
    // Retrieve the cookies option from the interaction
    const cookies = interaction.options.getString('cookies');

    // Register the client to determine if the cookies are valid
    const client = await register_client(interaction, cookies);
    if (!client)
        return interaction.safe_reply({
            ephemeral: true,
            content:
                'The cookies you have provided are either invalid or expired. Please try again with valid cookies.',
        });

    // Return a success message
    interaction.safe_reply({
        content: `Setup as **${client.name}**, your Blackboard account will now be used for all other commands.`,
        ephemeral: true,
    });
}
