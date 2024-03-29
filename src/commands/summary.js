import { get_registered_client } from '../blackboard/methods.js';
import { spread_fields_over_embeds } from '../utils.js';

export const SUMMARY_TYPES = {
    UPCOMING_ASSIGNMENTS: 'Upcoming To-Do Assignments',
    PAST_DUE_ASSIGNMENTS: 'Past Due-Date Assignments',
    RECENTLY_GRADED_ASSIGNMENTS: 'Recently Graded Assignments',
};

/**
 * Builds and returns the `summary` command.
 * @param {import('discord.js').SlashCommandBuilder} builder
 * @returns {import('discord.js').SlashCommandBuilder}
 */
export function build_summary_command(builder) {
    return builder
        .setName('summary')
        .setDescription('Displays a summary of the specified content type from Blackboard.')
        .addStringOption((option) =>
            option
                .setName('type')
                .setDescription('The type of summary to display.')
                .setRequired(true)
                .addChoices(
                    ...Object.keys(SUMMARY_TYPES).map((key) => ({
                        name: SUMMARY_TYPES[key],
                        value: key,
                    }))
                )
        )
        .addNumberOption((option) =>
            option
                .setName('max_courses_age')
                .setDescription(
                    'Maximum age in "number of months" to filter out past courses. (Default: 6 aka. 6 Months)'
                )
                .setMinValue(1)
                .setMaxValue(48)
                .setRequired(false)
        );
}

/**
 * Handles interactions for the `summary` command.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<void>}
 */
export async function on_summary_command(interaction) {
    // Retrieve the command options
    const summary_type = interaction.options.getString('type');
    const max_courses_age = interaction.options.getNumber('max_courses_age') || 6;

    // Retrieve the Blackboard client from the database
    const client = get_registered_client(interaction);
    if (!client) throw new Error('NO_CLIENT');

    // Generate the summary embed based on the summary type
    const embeds = await generate_summary_embeds(client, summary_type, 1000 * 60 * 60 * 24 * 30 * max_courses_age);

    // Send the embed to the user
    await interaction.safe_reply({ embeds, ephemeral: true });
}

/**
 * Returns an up-to-date summary embed for the specified type.
 *
 * @param {import('../blackboard/client.js').BlackboardClient} client
 * @param {('UPCOMING_ASSIGNMENTS'|'RECENTLY_GRADED_ASSIGNMENTS')} type
 * @param {number=} max_courses_age - Maximum age in milliseconds to filter out past courses
 * @returns {Promise<Object>}
 */
export async function generate_summary_embeds(client, type, max_courses_age = Infinity) {
    // Convert the type to the appropriate value for filtering summary data
    type = SUMMARY_TYPES[type];

    // Retrieve the most recently available courses from Blackboard
    const courses = await client.get_all_courses(max_courses_age);

    // Filter out courses that are being ignored
    Object.keys(courses).forEach((id) => {
        const course = courses[id];
        if (client.ignored('courses', course.id)) delete courses[id];
    });

    // Determine a filter status for the assignments
    let status;
    let min_deadline_at = 0;
    let max_deadline_at = Infinity;
    switch (type) {
        case SUMMARY_TYPES.UPCOMING_ASSIGNMENTS:
            status = 'UPCOMING';
            min_deadline_at = Date.now();
            max_deadline_at = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 Days to cut down on search time
            break;
        case SUMMARY_TYPES.PAST_DUE_ASSIGNMENTS:
            status = 'PAST_DUE';
            max_deadline_at = Date.now();
            break;
        case SUMMARY_TYPES.RECENTLY_GRADED_ASSIGNMENTS:
            status = 'GRADED';
            max_deadline_at = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 Days to cut down on search time
            break;
    }

    // Retrieve each course's assignments
    const names = Object.keys(courses);
    const results = await Promise.all(
        names.map((key) =>
            client.get_all_assignments(courses[key], {
                status,
                detailed: true,
                min_deadline_at,
                max_deadline_at,
            })
        )
    );

    // Convert the resolved array into an object with the course names as keys
    // Filter assignments based on the specified type
    const assignments = [];
    for (let i = 0; i < names.length; i++) {
        // Check if assignments.scores were cached for this course
        const course = courses[names[i]];
        const identifier = `assignments.scores.${course.id}`;
        const cached_scores = client.get_from_cache(identifier, names[i]);
        if (cached_scores) {
            // Filter the assignments based on the specified type
            const filtered = results[i]
                .filter(({ id, status, deadline_at, grade: { score } }) => {
                    switch (type) {
                        case SUMMARY_TYPES.UPCOMING_ASSIGNMENTS:
                            // Filter out assignments that are not upcoming
                            // Filter out assignments whose due date is in the past
                            return status === 'UPCOMING' && deadline_at > Date.now();
                        case SUMMARY_TYPES.PAST_DUE_ASSIGNMENTS:
                            // Filter out assignments that are not upcoming
                            // Filter out assignments whose due date is in the future
                            // Filter out assignments that are older than 30 days
                            return (
                                status === 'UPCOMING' &&
                                deadline_at < Date.now() &&
                                Date.now() - deadline_at < 1000 * 60 * 60 * 24 * 30
                            );
                        case SUMMARY_TYPES.RECENTLY_GRADED_ASSIGNMENTS:
                            // Ensure the assignment has been graded
                            // Ensure the assignment score is different from cached score
                            const cached_score = cached_scores[id];
                            return status === 'GRADED' && (!cached_score || cached_score !== score);
                    }
                })
                .map((assignment) => {
                    // Include the course object in the assignment
                    assignment.course = courses[names[i]];
                    return assignment;
                });

            // If there are some assignments, update the cache
            if (filtered.length) {
                filtered.forEach(({ id, grade: { score } }) => (cached_scores[id] = score));
                client.set_in_cache(identifier, cached_scores, 1000 * 60 * 60 * 24 * 30 * 6); // 6 Months cache time
            }

            // Add the assignments to the array
            assignments.push(...filtered);
        } else {
            // Cache the assignments.scores for this course
            const assignment_scores = {};
            results[i].forEach(({ id, grade: { score } }) => (assignment_scores[id] = score));
            client.set_in_cache(identifier, assignment_scores, 1000 * 60 * 60 * 24 * 30 * 6); // 6 Months cache time
        }
    }

    // Sort the assignments
    assignments.sort((a, b) => {
        // Sort by last updated date (descending)
        if (type === SUMMARY_TYPES.RECENTLY_GRADED_ASSIGNMENTS) return b.updated_at - a.updated_at;

        // Sort by due date (ascending)
        return a.deadline_at - b.deadline_at;
    });

    // Determine a readable description for the summary based on the assignments and time distance
    let description = 'You have **0** upcoming assignments.';
    switch (type) {
        case SUMMARY_TYPES.UPCOMING_ASSIGNMENTS:
            // Ensure there are assignments
            if (assignments.length) {
                // Determine how near the first assignment's due date is
                const hour = 1000 * 60 * 60;
                const first_assignment = assignments[0];
                const nearest_due_date = first_assignment.deadline_at;

                // Determine the milliseconds span interval and time unit between now and the first assignment's due date
                let interval,
                    deadline,
                    count = 0;
                if (nearest_due_date - Date.now() < hour * 24) {
                    interval = hour * 24;
                    deadline = 'over next the 24 hours';
                } else if (nearest_due_date - Date.now() < hour * 24 * 7) {
                    interval = hour * 24 * 7;
                    deadline = 'this week';
                } else if (nearest_due_date - Date.now() < hour * 24 * 14) {
                    interval = hour * 24 * 7 * 14;
                    deadline = 'next week';
                } else {
                    interval = Infinity;
                    deadline = 'in the future';
                }

                // Count the number of assignments due within the specified interval
                count = assignments.filter((assignment) => assignment.deadline_at - Date.now() < interval).length;

                // Determine the description based on the number of assignments due within the specified interval
                description = `You have **${count}** upcoming assignment(s) due **${deadline}**.`;
            }
            break;
        case SUMMARY_TYPES.PAST_DUE_ASSIGNMENTS:
            description = `You have **${assignments.length}** past due assignment(s).`;
            break;
        case SUMMARY_TYPES.RECENTLY_GRADED_ASSIGNMENTS:
            description = `You have **${assignments.length}** recently graded assignment(s).`;
            break;
    }

    // Convert the summary into an embed
    return spread_fields_over_embeds({
        title: type,
        description,
        fields: assignments.slice(0, 10).map(({ name, course, deadline_at, grade }) => ({
            name,
            value: [
                grade?.score
                    ? `Grade: \`${grade.score} / ${grade.possible} - ${Math.round(grade.score / grade.possible)}%\``
                    : '',
                `Deadline: <t:${Math.floor(deadline_at / 1000)}:R>`,
                `**[[View Course]](${course.url})**`,
            ]
                .filter((line) => line.length > 0)
                .join('\n'),
        })),
    });
}
