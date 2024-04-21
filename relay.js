import { createServer } from "net";
import { config } from "./config.js";
import Logger from "@ptkdev/logger";

const options = {
  language: "en",
  colors: true,
  debug: config.log_level === "debug",
  info: config.log_level === "info" || config.log_level === "debug",
  warning:
    config.log_level === "warning" ||
    config.log_level === "info" ||
    config.log_level === "debug",
  error:
    config.log_level === "error" ||
    config.log_level === "warning" ||
    config.log_level === "info" ||
    config.log_level === "debug",
  sponsor: false,
  write: false,
  type: "log",
};

const logger = new Logger(options);

const auth_server = createServer();

class Auth {
  async CMD_AUTH_LOGON_CHALLENGE_SERVER_VALIDATE_CLIENT_REQUEST(data) {
    try {
      const opcode = await data.readUInt8(0);
      if (opcode !== 0x00 && opcode !== 0x02) {
        console.log(`Unknown command: ${opcode}`);
        return false;
      }

      const protocol_version = await data.readUInt8(0x01);
      const packet_size = await data.readUInt16LE(0x02);
      const game_name = await data.toString("utf8", 0x04, 0x08);

      const versionArray = [];
      for (let i = 0; i < 3; i++) {
        const versionByte = await data.readUInt8(0x08 + i);
        versionArray.push(versionByte);
      }

      const version = versionArray.join(".");
      const build = await data.readUInt16LE(0x0b);
      const platform = await data.toString("utf8", 0x0d, 0x0d + 4);
      const os = await data.toString("utf8", 0x11, 0x11 + 4);
      const locale = await data.toString("utf8", 0x15, 0x15 + 4);
      const timezone_bias = await data.readInt32LE(0x19);
      const ip = await data.readUInt32LE(0x1d);
      const username_length = await data.readUInt8(0x21);
      const username = await data.toString(
        "utf8",
        0x22,
        0x22 + username_length
      );

      logger.debug(
        `Protocol Version: ${protocol_version}, Packet Size: ${packet_size}, Game Name: ${game_name}, Version: ${version}, Build: ${build}, Platform: ${platform
          .split("")
          .reverse()
          .join("")}, OS: ${os.split("").reverse().join("")}, Locale: ${locale
          .split("")
          .reverse()
          .join(
            ""
          )}, Timezone Bias: ${timezone_bias}, IP: ${ip}, Username Length: ${username_length}, Username: ${username}`
      );

      if (version !== config.game_version) {
        logger.error(`Invalid game version: ${version}`);
        return false;
      }

      if (build !== config.build) {
        logger.error(`Invalid build: ${build}`);
        return false;
      }

      if (!username_length) {
        logger.error(`Invalid username length: ${username_length}`);
        return false;
      }

      if (username_length + 0x22 - 4 !== packet_size) {
        logger.error(`Invalid packet size: ${packet_size}`);
        return false;
      }

      return {
        challenge_end_offset: username_length + 0x22,
        opcode: opcode,
        protocol_version: protocol_version,
        packet_size: packet_size,
        version: version,
        build: build,
        platform: platform,
        os: os,
        locale: locale,
        timezone_bias: timezone_bias,
        ip: ip,
        username_length: username_length,
        username: username,
        payload: data.slice(0x00, 0x22 + username_length),
      };
    } catch (error) {
      logger.error(`Error in CMD_AUTH_LOGON_CHALLENGE_SERVER: ${error}`);
    }

    return false;
  }
}

auth_server.on("connection", (socket) => {
  socket.UserIP = socket.remoteAddress.includes("::ffff:")
    ? socket.remoteAddress.replace("::ffff:", "")
    : socket.remoteAddress;
  logger.info(`New socket connection from ${socket.UserIP}`);

  socket.state = "auth";
  socket.offset = 0;
  const auth = new Auth(socket);

  setTimeout(() => {
    if (socket.state === "auth") {
      logger.error("Session timed out, closing connection");
      endSession();
    }
  }, 5000);

  async function endSession() {
    socket.end();
  }

  socket.on("data", async (data) => {
    if (socket.state === "auth") {
      const auth_challenge_data =
        await auth.CMD_AUTH_LOGON_CHALLENGE_SERVER_VALIDATE_CLIENT_REQUEST(
          data
        );

      if (auth_challenge_data) {
        socket.state = "auth_challenge_1";
        socket.offset = auth_challenge_data.challenge_end_offset;
      } else {
        logger.error("Invalid packet, closing connection");
        endSession();
      }
    }
  });

  socket.on("end", () => {
    logger.info("Client disconnected");
  });

  socket.on("error", (error) => {
    logger.error(`Socket error: ${error}`);
  });
});

auth_server.listen(config.auth_port, () => {
  logger.info(`Auth Server listening on port ${config.auth_port}`);
});
