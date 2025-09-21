import { WebFetchServer } from './WebFetchServer';

const server = new WebFetchServer();
server.run().catch(console.error);