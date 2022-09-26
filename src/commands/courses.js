import { get_registered_client } from '../blackboard/methods.js';
import { spread_fields_over_embeds } from '../utils.js';

export const COURSE_ACTIONS = {
    LIST: 'List All Courses',
    IGNORE: 'Ignore a Course',
    UNIGNORE: 'Un-Ignore a Course',
};

/**
 * Builds and returns the `courses` command.
 * @param {import('discord.js').SlashCommandBuilder} builder
 * @returns {import('discord.js').SlashCommandBuilder}
 */
export function build_courses_command(builder) {
    return builder
        .setName('courses')
        .setDescription('Manage courses that you are enrolled in on Blackboard.')
        .addStringOption((option) =>
            option
                .setName('action')
                .setDescription('The action to perform on the courses.')
                .setRequired(true)
                .addChoices(
                    ...Object.keys(COURSE_ACTIONS).map((key) => ({
                        name: COURSE_ACTIONS[key],
                        value: key,
                    }))
                )
        )
        .addNumberOption((option) =>
            option
                .setName('course_number')
                .setDescription('The course number to ignore/un-ignore content from. (Example: 3 for "Course #3")')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(100)
        )
        .addNumberOption((option) =>
            option
                .setName('max_course_age')
                .setDescription(
                    'Maximum age in "number of months" to filter out past courses. (Default: 6 aka. 6 Months)'
                )
                .setMinValue(1)
                .setMaxValue(48)
                .setRequired(false)
        );
}

/**
 * Handles interactions for the `courses` command.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<void>}
 */
export async function on_courses_command(interaction) {
    // Retrieve the command options
    const action = interaction.options.getString('action');
    const course_number = interaction.options.getNumber('course_number');
    const max_course_age = interaction.options.getNumber('max_course_age') || 6;

    // Retrieve the Blackboard client from the database
    const client = get_registered_client(interaction);
    if (!client) throw new Error('NO_CLIENT');

    // Retrieve the courses from Blackboard with the max age converted to milliseconds
    let courses;
    try {
        // Retrieve courses from Blackboard
        courses = await client.get_all_courses(1000 * 60 * 60 * 24 * 30 * max_course_age);

        // Ensure we have some courses
        if (Object.keys(courses).length === 0) throw new Error('No courses found.');
    } catch (error) {
        console.error(error);
        return await interaction.safe_reply({
            ephemeral: true,
            content: `Failed to retrieve courses from Blackboard. Please try again later or run the setup command again if this issue persists.`,
        });
    }

    // Send an embed with the list of courses if the action is to list them
    if (COURSE_ACTIONS[action] === COURSE_ACTIONS.LIST)
        return await interaction.safe_reply({
            embeds: spread_fields_over_embeds({
                title: 'Blackboard Courses',
                description: 'Below are some of the courses that are available on your Blackboard account.',
                fields: Object.keys(courses).map((key) => {
                    const { id, name, updated_at, urls } = courses[key];
                    const ignored = client.ignored('course', id);
                    return {
                        name: `Course ${key} ${ignored ? `**(Ignored)** ` : ''}`,
                        value: [
                            `Name: \`${name}\``,
                            `Last Updated <t:${Math.floor(updated_at / 1000)}:R>`,
                            ignored ? `**This course is currently being ignored.**` : ``,
                            `**[[View Course]](${client.base}${urls.class})** - **[[View Grades]](${client.base}${urls.grades})**`,
                        ]
                            .filter((line) => line.length > 0)
                            .join('\n'),
                    };
                }),
            }),
            ephemeral: true,
        });

    // Ensure the user has specified a valid course number for ignore/un-ignore actions
    const course = courses[`#${course_number}`];
    if (!course)
        return await interaction.safe_reply({
            ephemeral: true,
            content: `Please provide a valid **course number** for this action.`,
        });

    // Determine the type of action to perform
    const is_ignore = COURSE_ACTIONS[action] === COURSE_ACTIONS.IGNORE;

    // Ignore the course with the course Blackboard ID
    client[is_ignore ? 'ignore' : 'unignore']('course', course.id);

    // Reply with a success message
    return await interaction.safe_reply({
        ephemeral: true,
        content: `Successfully **${is_ignore ? 'ignored' : 'un-ignored'}** all content from \`${
            course.name
        }\` the course.`,
    });
}
