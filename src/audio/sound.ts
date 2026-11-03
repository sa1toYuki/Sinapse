let ctx: AudioContext | undefined;
export function sound(kind:'intro'|'correct'|'wrong'|'tick', enabled:boolean) {
 if(!enabled) return;
 try { ctx ??= new AudioContext(); if(ctx.state === 'suspended') void ctx.resume(); const now=ctx.currentTime; const notes=kind==='intro'?[392,494,587,784]:kind==='correct'?[523,659,784]:kind==='wrong'?[220,165]:[800]; notes.forEach((frequency,i)=>{const o=ctx!.createOscillator(), g=ctx!.createGain(); o.type=kind==='wrong'?'sawtooth':'sine'; o.frequency.value=frequency; const t=now+i*.12; g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(.09,t+.015); g.gain.exponentialRampToValueAtTime(.0001,t+(kind==='tick'?.05:.22)); o.connect(g);g.connect(ctx!.destination);o.start(t);o.stop(t+.23)}); } catch { /* audio is optional */ }
}
