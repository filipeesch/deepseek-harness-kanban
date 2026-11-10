import { baseStyles } from './base.js';
import { headerStyles } from './header.js';
import { cardStyles } from './cards.js';
import { activityStyles } from './activity.js';
import { motionStyles } from './motion.js';
import { sharingStyles } from './sharing.js';
import { drawerHeaderStyles } from './drawer-header.js';
import { workflowViewStyles } from '../workflow-view/styles.js';
import { scheduleStyles } from './schedules.js';
import { stageStyles } from './stage.js';

/** Every plugin style module in cascade order; the board mounts this one string. */
export const styles = [baseStyles, headerStyles, cardStyles, activityStyles, motionStyles, sharingStyles, drawerHeaderStyles, scheduleStyles, stageStyles, workflowViewStyles].join(String.fromCharCode(10));
