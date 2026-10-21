import test from 'node:test';
import assert from 'node:assert/strict';
import {AlertInbox} from './alertInbox';
test('reopening restores unread history silently; only new unread alerts speak',()=>{
  const inbox=new AlertInbox();
  const delivered: [number,boolean][]=[];
  const deliver=(item:{id:number;read:boolean},announce:boolean)=>{delivered.push([item.id,announce]);};
  inbox.receive([{id:1,read:false},{id:2,read:true}],deliver);
  inbox.receive([{id:2,read:true},{id:3,read:false},{id:4,read:true}],deliver);
  inbox.receive([{id:3,read:false},{id:4,read:true}],deliver);
  assert.deepEqual(delivered,[[1,false],[2,false],[3,true],[4,false]]);
  const reopened=new AlertInbox();
  reopened.receive([{id:3,read:false},{id:4,read:true}],deliver);
  assert.deepEqual(delivered.slice(-2),[[3,false],[4,false]]);
});
test('empty initial history still allows the first later alert to speak',()=>{
  const inbox=new AlertInbox();inbox.receive([],()=>assert.fail());
  inbox.receive([{id:1,read:false}],(_,announce)=>assert.equal(announce,true));
});
