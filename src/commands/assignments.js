import { get_registered_client } from '../blackboard/methods.js';
import { spread_fields_over_embeds } from '../utils.js';

/**
 * Builds and returns the `assignments` command.
 * @param {import('discord.js').SlashCommandBuilder} builder
 * @returns {import('discord.js').SlashCommandBuilder}
 */
export function build_assignments_command(builder) {
    return builder
        .setName('assignments')
        .setDescription('Displays a list of all assignments for the specified course.')
        .addNumberOption((option) =>
            option
                .setName('course_number')
                .setDescription('The course number to display assignments for. (Example: 3 for "Course #3")')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)
        )
        .addStringOption((option) =>
            option
                .setName('status')
                .setDescription('Filter assignments by their status.')
                .setRequired(false)
                .addChoices(
                    {
                        name: 'Upcoming Only',
                        value: 'UPCOMING',
                    },
                    {
                        name: 'Submitted Only',
                        value: 'SUBMITTED',
                    },
                    {
                        name: 'Graded Only',
                        value: 'GRADED',
                    },
                    {
                        name: 'Past-Due Only',
                        value: 'PAST_DUE',
                    }
                )
        );
}

/**
 * Handles interactions for the `assignments` command.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<void>}
 */
export async function on_assignments_command(interaction) {
    // Retrieve the options from the interaction
    const course_status = interaction.options.getString('status');
    const course_number = interaction.options.getNumber('course_number');

    // Retrieve the client associated with the interaction
    const client = get_registered_client(interaction);
    if (!client) throw new Error('NO_CLIENT');

    // Retrieve the course from the cache
    const courses = await client.get_all_courses(Infinity);
    const course = courses[`#${course_number}`];
    if (!course) throw new Error('NO_COURSE');

    // Retrieve the assignments from Blackboard
    const assignments = await client.get_all_assignments(course, {
        status: course_status,
    });

    // Sort assignments by closest deadline to current timestamp
    assignments.sort((a, b) => {
        const current = Date.now();
        const a_diff = Math.abs(a.deadline_at - current);
        const b_diff = Math.abs(b.deadline_at - current);
        return a_diff - b_diff;
    });

    // Build the embed message
    const embed = {
        title: 'Blackboard Assignments',
        description: `Below are your requested assignments for **${course.name}**`,
        fields: assignments.length
            ? assignments.map(({ name, status, deadline_at, grade }) => ({
                  name: name.substring(0, 256), // Truncate the name to 256 characters to prevent errors from Discord limits
                  value: [
                      `Status: \`${status}\``,
                      grade?.score
                          ? `Grade: \`${grade.score} / ${grade.possible} - ${Math.round(
                                (grade.score / grade.possible) * 100
                            )}%\``
                          : '',
                      `Due Date: <t:${Math.floor(deadline_at / 1000)}:R>`,
                  ]
                      .filter((line) => line.length > 0)
                      .join('\n'),
              }))
            : [{ name: 'No Assignments', value: 'No assignments were found for this course with your query.' }],
    };

    // Reply to the interaction with the embed message
    await interaction.safe_reply({ embeds: spread_fields_over_embeds(embed), ephemeral: true });
}
