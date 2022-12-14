import { perform_blackboard_login } from '../blackboard/auth.js';
import { register_client } from '../blackboard/methods.js';

/**
 * Builds and returns the `login` command.
 * @param {import('discord.js').SlashCommandBuilder} builder
 * @returns {import('discord.js').SlashCommandBuilder}
 */
export function build_login_command(builder) {
    return builder
        .setName('login')
        .setDescription('Login to your CUNY Blackboard account to use all available commands.')
        .addStringOption((option) =>
            option.setName('username').setDescription('Your CUNYFirst username.').setRequired(false)
        )
        .addStringOption((option) =>
            option.setName('password').setDescription('Your CUNYFirst password.').setRequired(false)
        );
}

/**
 * Handles interactions for the  `login` command.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<void>}
 */
export async function on_login_command(interaction) {
    // Retrieve the username and password from the interaction options
    const username = interaction.options.getString('username');
    const password = interaction.options.getString('password');

    // Return an error if neither the username and password or cookies are provided
    if (!username && !password && !cookies)
        return await interaction.safe_reply({
            content: 'You must provide either your username and password or existing Blackboard session cookies.',
            ephemeral: true,
        });

    // Perform Blackboard login to generate fresh token
    let token;
    try {
        token = await perform_blackboard_login(username, password);
    } catch (error) {
        console.error(error);
        return await interaction.safe_reply({
            content:
                'The username or password you provided is incorrect. Please try again with your CUNYFirst username and password.',
            ephemeral: true,
        });
    }

    // Register the client to determine if the cookies are valid
    const client = await register_client(interaction, token);
    if (!client)
        return interaction.safe_reply({
            ephemeral: true,
            content:
                'The cookies you have provided are either invalid or expired. Please try again with valid cookies.',
        });

    // Return a success message
    interaction.safe_reply({
        content: `Logged in as **${client.name}**, your Blackboard account will now be used for all other commands.`,
        ephemeral: true,
    });
}
