// Runs existing unit suites against copies of Jarvis, never the user's live data.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const backend = path.resolve(__dirname, '..');
const root = path.join(backend, 'data/diagnostics/full-audit/isolated');
const defaultNames = [
 'test_action_explanation','test_action_timeline','test_behavior_profiles','test_circuit_breaker',
 'test_conditional_automation','test_confidence_engine','test_dashboard_service','test_entity_graph',
 'test_event_bus_proactive','test_fallback_engine','test_goal_system','test_hybrid_memory',
 'test_memory_consolidation','test_memory_importance','test_memory_long_term','test_memory_scale',
 'test_model_router','test_operation_metrics','test_persistent_task_manager','test_planner_executor_verifier',
 'test_procedure_learning_v2','test_procedure_registry','test_profile_and_embeddings','test_project_memory',
 'test_response_formatter','test_restart_recovery','test_risk_assessment','test_sandbox_hardening',
 'test_sandboxing','test_secret_vault','test_skill_permissions','test_skill_testing','test_skill_versioning',
 'test_structured_logger','test_structured_outputs','test_task_manager','test_token_budget_memory',
 'test_tool_registry','test_universal_memory','test_wake_sleep_state','test_wake_word_pipeline',
 'regression_safety_suite','voice_intent_test','test_daily_commands','test_full_command_pipeline',
 'test_document_templates','test_snapshot_service','test_git_integration','test_coding_agent',
 'test_activity_context','test_home_assistant','test_auto_heal','test_research_service',
 'test_browser_real_e2e','test_open_app_fixes','test_hardened_code_act','test_mcp_architecture','test_canonical_llm','test_browser_confirmations','core.test','test_smart_clipboard'
];
const names = process.argv.length > 2 ? process.argv.slice(2) : defaultNames;
fs.mkdirSync(root, { recursive: true });
const results = [];
async function run(name) {
 const project = path.join(root, `${name}-${Date.now()}`);
 const copy = path.join(project, 'backend');
 for (const dir of ['services', 'tests', 'scripts']) fs.cpSync(path.join(backend, dir), path.join(copy, dir), { recursive: true });
 fs.mkdirSync(path.join(copy, 'data'), { recursive: true });
 fs.copyFileSync(path.join(backend,'data/voice_settings.json'),path.join(copy,'data/voice_settings.json'));
 fs.cpSync(path.resolve(backend,'../frontend'),path.join(project,'frontend'),{recursive:true});
 const modules = path.join(copy, 'node_modules');
 if (!fs.existsSync(modules)) fs.symlinkSync(path.join(backend, 'node_modules'), modules, 'junction');
 const home = path.join(project, 'home');
 for (const dir of ['Desktop','Documents','Downloads','Pictures','Music','Videos']) fs.mkdirSync(path.join(home,dir),{recursive:true});
 const bootstrap = path.join(project, 'bootstrap.cjs');
 fs.writeFileSync(bootstrap, `require('os').homedir = () => ${JSON.stringify(home)}; process.env.JARVIS_DESKTOP_DIR = ${JSON.stringify(path.join(home,'Desktop'))}; const notifierPath = require.resolve(${JSON.stringify(path.join(backend,'node_modules/node-notifier'))}); require(notifierPath); require.cache[notifierPath].exports = { notify() {}, WindowsToaster: class { notify() {} } };`);
 const started = Date.now();
 return new Promise(resolve => execFile(process.execPath, ['-r', bootstrap, path.join(copy, 'tests', name+'.js')], {
   cwd: project, windowsHide: true, timeout: 25000, maxBuffer: 256*1024,
   env: { ...process.env, USERPROFILE: name.includes('browser') ? process.env.USERPROFILE : home, JARVIS_DESKTOP_DIR: path.join(home,'Desktop'), JARVIS_PYTHON_EXE: path.resolve(backend,'../python_engine/venv/Scripts/python.exe'), JARVIS_REAL_E2E: '0' }
 }, (error, stdout, stderr) => {
   const result = { name, log: path.join(project,'result.log'), status: error ? (error.killed ? 'TIMEOUT' : 'FAIL') : 'PASS', ms: Date.now()-started, code: error?.code || 0 };
   fs.writeFileSync(path.join(project,'result.log'),stdout+'\n'+stderr);
   if(error) result.detail = (stderr || stdout).slice(-2200);
   fs.writeFileSync(path.join(project,'result.json'),JSON.stringify(result,null,2));
   results.push(result);
   fs.writeFileSync(path.join(root,'results.json'), JSON.stringify(results,null,2));
   console.log(JSON.stringify(result)); resolve();
 }));
}
(async()=>{ const queue=[...names]; await Promise.all([1,2].map(async()=>{while(queue.length) await run(queue.shift());})); console.log('AUDIT_FINISHED',JSON.stringify(results.reduce((s,r)=>(s[r.status]=(s[r.status]||0)+1,s),{}))); if (results.some(r=>r.status!=='PASS')) process.exitCode=1; })().catch(error=>{console.error(error);process.exitCode=1;});
