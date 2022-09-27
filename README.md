# CUNY Blackboard Bot: A Discord Bot To Manage Your Courses, Assignments & More
#### Powered by [`Discord.js`](https://github.com/discordjs/discord.js)

## How To Install?

1. Install [[> Node.js]](https://nodejs.org/en/) v18+ (recommended) on your machine.
2. Clone this **repository** to your machine.
3. Run `npm install` inside of the cloned directory.
4. Create a copy of `example.env`, name it `.env`, fill the variables as instructed.
    - **Required:** See [[> Discord Developer Portal]](https://discord.com/developers/docs/intro) for creating a Discord bot and application.
5. Run the `index.js` file using `node index.js` to start your bot.
    - **Optional:** You may install `pm2` and run `index.js` with `pm2` for 24/7 uptime.
6. Invite the Discord `Bot` to your Discord `Server` using the `invite link` logged in the terminal / console of `index.js`.
7. Run the `/blackboard login` command to connect your CUNY Blackboard account with the bot.
    - **Note** the `/blackboard` command may be different if you have specified a different `COMMAND_PREFIX` in your `.env` file.

## How To Use?
The Discord Bot has various `slash commands` to manage your Blackboard courses, assigments, alerts and more. 
Simply type `/blackboard` in any channel to see all available commands and their respective descriptions / options.

## Limitations
This bot was written to be used for personal use only hence some of the limitations below.
- Each connected Blackboard account's name, session cookies, preferences and other cache data is stored in a JSON on the filesystem.
- While the bot can multiple Discord users in as many servers as the bot is a member of, there is no way to control permissions for individual users.
- While you may host the bot and allow your peers to use the bot in a shared Discord server, all users should be mindful that their Blackboard can be accessed by the host easily due to the limitations above.

## License
[MIT](./LICENSE)
