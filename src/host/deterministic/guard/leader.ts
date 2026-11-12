import { spawn, type ChildProcess } from 'node:child_process';

/**
 * The process-group leader of one Bash call. It runs the reviewed program from a
 * private file whose path is the only argument, so the program text never appears on
 * a process command line. It kills its own group when the guard disconnects or asks it
 * to terminate, so a native kill of the guard cannot leave the group behind.
 */
export const LEADER_SOURCE = "const {spawn}=require('node:child_process');const terminate=()=>process.kill(-process.pid,'SIGKILL');process.on('disconnect',terminate);process.on('message',message=>{if(message&&message.terminate)terminate();});const child=spawn('bash',[process.argv[1]],{stdio:['inherit','pipe','pipe']});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);child.on('error',()=>process.send({outcome:127}));child.on('close',(code,signal)=>process.send({outcome:code===null?130:code}));setInterval(()=>{},2147483647);";

/** Starts the detached leader that owns the command's own process group. */
export function spawnLeader(scriptPath: string, marker: string): ChildProcess {
  return spawn(process.execPath, ['-e', LEADER_SOURCE, scriptPath], { detached: true, stdio: ['inherit', 'pipe', 'pipe', 'ipc'], env: Object.assign({}, process.env, { DSH_DETERMINISTIC_RUN: marker }) });
}
