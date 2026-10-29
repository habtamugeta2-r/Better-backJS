import { BetterBack } from 'better-back';
import { AppModule, buildUserApiOptions } from './app.module.js';

const app = await BetterBack.create(AppModule, buildUserApiOptions());
await app.listen();
