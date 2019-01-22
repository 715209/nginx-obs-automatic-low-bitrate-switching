import WebSocket from "ws";
import config from "../../config";

// TODO add reconnect on disconnect

class Chat {
  constructor(username, password, channel, obs) {
    this.username = username; // username
    this.password = password; // oauth
    this.channel = `#${channel}`; // #channel
    this.ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    this.obsProps = obs;
    this.obs = obs.obs;
    this.prefix = "!";
    this.commands = [
      "host",
      "unhost",
      "start",
      "stop",
      "switch",
      "raid",
      "bitrate",
      "info",
      "refresh"
    ];
    this.allowAllCommands = ["bitrate", "info"];
    this.allowModsCommands = ["refresh"];
    this.wait = false;
    this.rate = 0;
    this.rateInterval = false;
    this.isRefreshing = false;

    this.ws.onopen = this.onOpen.bind(this);
    this.ws.onmessage = this.onMessage.bind(this);
    this.ws.onerror = this.onError.bind(this);
    this.ws.onclose = this.onClose.bind(this);

    this.obsProps.on("live", this.live.bind(this));
    this.obsProps.on("normalScene", this.onNormalScene.bind(this));
    this.obsProps.on("lowBitrateScene", this.onLowBitrateScene.bind(this));
    this.obsProps.on("offlineScene", this.onOfflineScene.bind(this));
  }

  keepAlive() {
    this.interval = setInterval(() => {
      this.ws.send("PING :tmi.twitch.tv\r\n");
    }, 2000);
  }

  onOpen() {
    if (this.ws !== null && this.ws.readyState === 1) {
      console.log("Successfully Connected to websocket");
      console.log(`Authenticating and joining channel ${this.channel}`);

      this.ws.send("CAP REQ :twitch.tv/tags");
      this.ws.send(`PASS ${this.password}`);
      this.ws.send(`NICK ${this.username}`);
      this.ws.send(`JOIN ${this.channel}`);

      this.keepAlive();
    }
  }

  onClose() {
    console.log("Disconnected from the chat server.");
    clearInterval(this.interval);
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }

  onError(e) {
    console.log(`Error: ${e}`);
  }

  onMessage(message) {
    if (message !== null) {
      const parsed = this.parse(message.data);

      if (parsed !== null) {
        if (parsed.command === "PRIVMSG") {
          // not a command
          if (parsed.message.substr(0, 1) !== this.prefix) return;

          // Split the message into individual words:
          const parse = parsed.message.slice(1).split(" ");
          const commandName = parse[0];

          if (
            (config.twitchChat.adminUsers.includes(parsed.username) &&
              this.rate != 20) ||
            (config.twitchChat.enablePublicCommands &&
              this.allowAllCommands.includes(commandName) &&
              !this.wait &&
              this.rate != 20) ||
            (config.twitchChat.enableModCommands &&
              parsed.tags.mod === "1" &&
              this.allowModsCommands.includes(commandName) &&
              this.rate != 20) ||
            (parsed.username === this.channel.substring(1) && this.rate != 20)
          ) {
            if (this.commands.includes(commandName)) {
              this[commandName](parse[1]);

              console.log(`! Executed ${commandName} command`);
              this.setWait();
            } else {
              console.log(`! Unknown command ${commandName}`);
            }
          }
        } else if (parsed.command === "PING") {
          this.ws.send(`PONG :${parsed.message}`);
        }
      }
    }
  }

  parse(message) {
    let parsedMessage = {
      tags: {},
      channel: null,
      command: null,
      username: null,
      message: null,
      raw: message
    };

    const firstString = message.split(" ", 1)[0];

    if (message[0] === "@") {
      var space = message.indexOf(" ");
      const tagsRaw = message.slice(1, space);
      const tagsSplit = tagsRaw.split(";");

      tagsSplit.map(d => {
        const tagSplit = d.split("=");
        parsedMessage.tags[tagSplit[0]] = tagSplit[1];
      });

      const userIndex = message.indexOf("!");
      parsedMessage.username = message.slice(space + 2, userIndex);

      const commandIndex = message.indexOf(" ", userIndex);
      const channelIndex = message.indexOf("#", space);

      parsedMessage.command = message.slice(commandIndex + 1, channelIndex - 1);
      const messageIndex = message.indexOf(":", commandIndex);

      parsedMessage.channel = message.slice(channelIndex, messageIndex - 1);
      parsedMessage.message = message.slice(
        messageIndex + 1,
        message.length - 2
      );
    } else if (firstString === "PING") {
      parsedMessage.command = "PING";
      parsedMessage.message = message.split(":")[1];
    }

    return parsedMessage;
  }

  setWait() {
    this.rate++;

    if (!this.rateInterval) {
      this.rateInterval = true;

      setTimeout(() => {
        this.rate = 0;
        this.rateInterval = false;
      }, 30000);
    }

    if (!this.wait) {
      this.wait = true;

      setTimeout(() => {
        this.wait = false;
      }, 2000);
    }
  }

  host(username) {
    if (username != null) {
      this.ws.send(`PRIVMSG ${this.channel} :/host ${username}`);

      setTimeout(() => {
        this.stop();
      }, config.twitchChat.stopStreamOnHostInterval);
    } else {
      this.ws.send(`PRIVMSG ${this.channel} :Error no username`);
      console.log("Error executing host command no username");
    }
  }

  unhost() {
    this.ws.send(`PRIVMSG ${this.channel} :/unhost`);
  }

  raid(username) {
    if (username != null) {
      this.ws.send(`PRIVMSG ${this.channel} :/raid ${username}`);

      setTimeout(() => {
        this.stop();
      }, config.twitchChat.stopStreamOnRaidInterval);
    } else {
      console.log("Error executing host command no username");
      this.ws.send(`PRIVMSG ${this.channel} :Error no username`);
    }
  }

  async start() {
    // start streaming
    try {
      await this.obs.startStreaming();
      this.ws.send(`PRIVMSG ${this.channel} :Successfully started stream`);
    } catch (e) {
      console.log(e);
      this.ws.send(`PRIVMSG ${this.channel} :Error ${e.error}`);
    }
  }

  async stop() {
    // stop streaming
    try {
      await this.obs.stopStreaming();

      this.ws.send(`PRIVMSG ${this.channel} :Successfully stopped stream`);
    } catch (e) {
      console.log(e.error);
      this.ws.send(`PRIVMSG ${this.channel} :${e.error}`);
    }
  }

  async switch(sceneName) {
    // switch scene
    try {
      await this.obs.setCurrentScene({ "scene-name": sceneName });

      this.ws.send(
        `PRIVMSG ${this.channel} :Scene successfully switched to "${sceneName}"`
      );
    } catch (e) {
      console.log(e);
    }
  }

  bitrate() {
    this.ws.send(
      `PRIVMSG ${this.channel} :Current bitrate: ${this.obsProps.bitrate}`
    );
  }

  info() {
    this.ws.send(
      `PRIVMSG ${this.channel} :Current scene: ${
        this.obsProps.currentScene
      } and bitrate: ${this.obsProps.bitrate}`
    );
  }

  async refresh() {
    // switch scene
    if (!this.isRefreshing) {
      try {
        await this.obs.setCurrentScene({
          "scene-name": config.obs.refreshScene
        });

        this.ws.send(`PRIVMSG ${this.channel} :Refreshing stream`);
        this.isRefreshing = true;

        setTimeout(() => {
          this.obs.setCurrentScene({
            "scene-name": config.obs.normalScene
          });

          this.ws.send(`PRIVMSG ${this.channel} :Refreshing stream completed`);
          this.isRefreshing = false;
        }, config.obs.refreshSceneInterval);
      } catch (e) {
        console.log(e);
      }
    }
  }

  live() {
    this.ws.send(`PRIVMSG ${this.channel} :Stream went live`);
  }

  onNormalScene() {
    this.ws.send(
      `PRIVMSG ${this.channel} :Scene switched to "${config.obs.normalScene}"`
    );

    this.bitrate();
  }

  onLowBitrateScene() {
    this.ws.send(
      `PRIVMSG ${this.channel} :Scene switched to "${
        config.obs.lowBitrateScene
      }"`
    );

    this.bitrate();
  }

  onOfflineScene() {
    this.ws.send(`PRIVMSG ${this.channel} :Stream went offline`);
  }
}

export default Chat;
