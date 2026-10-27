import { config } from '../config.js';
import { createSnowflake } from './snowflake.js';

export const nextId = createSnowflake(config.workerId);
