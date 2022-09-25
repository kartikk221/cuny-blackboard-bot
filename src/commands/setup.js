import { register_client } from '../blackboard/methods.js';

/**
 * Builds and returns the `setup` command.
 * @param {import('discord.js').SlashCommandBuilder} builder
 * @returns {import('discord.js').SlashCommandBuilder}
 */
export function build_setup_command(builder) {
    return builder
        .setName('setup')
        .setDescription('Setup your Blackboard account with the bot using cookies.')
        .addStringOption((option) =>
            option.setName('cookies').setDescription('Enter your blackboard cookies here.').setRequired(true)
        );
}

/**
 * Handles interactions for the  `setup` command.
 *
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<void>}
 */
export async function on_setup_command(interaction) {
    // Retrieve the cookies option from the interaction
    const cookies = interaction.options.getString('cookies');

    // Defer the reply as Blackboard may take a while to respond
    await interaction.deferReply({ ephemeral: true });

    // Register the client to determine if the cookies are valid
    const client = await register_client(interaction, cookies);
    if (!client)
        return interaction.followUp({
            ephemeral: true,
            content:
                'The cookies you have provided are either invalid or expired. Please try again with valid cookies.',
        });

    // Return a success message
    interaction.followUp({
        content: `Setup as **${client.name}**, your Blackboard account will now be used for all other commands.`,
        ephemeral: true,
    });
}
