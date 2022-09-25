import { RegisteredClients } from '../blackboard.js';

/**
 * Builds and returns the `courses` command.
 * @param {import('discord.js').SlashCommandBuilder} builder
 * @returns {import('discord.js').SlashCommandBuilder}
 */
export function build_courses_command(builder) {
    return builder
        .setName('courses')
        .setDescription('Displays a list of all courses that you are enrolled in on Blackboard.')
        .addNumberOption((option) =>
            option
                .setName('max_age')
                .setDescription('Maximum age in months to filter out past courses')
                .setMinValue(1)
                .setMaxValue(48)
                .setRequired(false)
        );
}

/**
 * Handles interactions for the `courses` command.
 *
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<void>}
 */
export async function on_courses_command(interaction) {
    // Retrieve the user identifier and cookies from the interaction
    const indentifier = interaction.user.id;
    const max_age = interaction.options.getNumber('max_age') || 6;

    // Retrieve the Blackboard client from the database
    const client = RegisteredClients.get(indentifier);
    if (!client)
        return await interaction.reply({
            ephemeral: true,
            content: `Your Blackboard account has not been setup for this command yet. Please run the \`${process.env['COMMAND_PREFIX']} setup\` command to resolve this issue.`,
        });

    // Defer the reply to account for the time it takes to retrieve the courses
    await interaction.deferReply({ ephemeral: true });

    // Retrieve the courses from Blackboard with the max age converted to milliseconds
    const courses = await client.get_all_courses(1000 * 60 * 60 * 24 * 30 * max_age);

    // Build the embed message
    const embed = {
        title: 'Blackboard Courses',
        description: 'Below are the courses that you are enrolled in on Blackboard.',
        fields: Object.keys(courses).map((key) => {
            const { name, updated_at, urls } = courses[key];

            // Simplify the name of the course
            const simplified = name.split?.('[')?.[0]?.trim?.() || name;

            // Return a formatted field
            return {
                name: `Course ${key}`,
                value: `Name: \`${simplified}\`\nLast Updated <t:${Math.floor(
                    updated_at / 1000
                )}:R>\n**[[View Course]](${client.base}${urls.class})** - **[[View Grades]](${client.base}${
                    urls.grades
                })**`,
            };
        }),
    };

    // Reply to the interaction with the embed message
    await interaction.followUp({ embeds: [embed], ephemeral: true });
}
