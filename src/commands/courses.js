import { get_registered_client } from '../blackboard/methods.js';
import { spread_fields_over_embeds } from '../utils.js';

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
    // Retrieve the max age option from the interaction
    const max_age = interaction.options.getNumber('max_age') || 6;

    // Retrieve the Blackboard client from the database
    const client = get_registered_client(interaction);
    if (!client) throw new Error('NO_CLIENT');

    // Defer the reply as Blackboard may take a while to respond
    await interaction.deferReply({ ephemeral: true });

    // Retrieve the courses from Blackboard with the max age converted to milliseconds
    let courses;
    try {
        // Retrieve courses from Blackboard
        courses = await client.get_all_courses(1000 * 60 * 60 * 24 * 30 * max_age);

        // Ensure we have some courses
        if (Object.keys(courses).length === 0) throw new Error('No courses found.');
    } catch (error) {
        return await interaction.followUp({
            ephemeral: true,
            content: `Failed to retrieve courses from Blackboard. Please try again later or run the setup command again if this issue persists.`,
        });
    }

    // Build the embed message
    const embed = {
        title: 'Blackboard Courses',
        description: 'Below are some of the courses that are available on your Blackboard account.',
        fields: Object.keys(courses).map((key) => {
            const { name, updated_at, urls } = courses[key];
            return {
                name: `Course ${key}`,
                value: `Name: \`${name}\`\nLast Updated <t:${Math.floor(updated_at / 1000)}:R>\n**[[View Course]](${
                    client.base
                }${urls.class})** - **[[View Grades]](${client.base}${urls.grades})**`,
            };
        }),
    };

    // Reply to the interaction with the embed message
    await interaction.followUp({ embeds: spread_fields_over_embeds(embed), ephemeral: true });
}
