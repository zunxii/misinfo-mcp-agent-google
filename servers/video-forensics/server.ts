import { VideoForensicsServer } from "./VideoForensicsServer";

const server = new VideoForensicsServer();
server.run().catch(console.error);
