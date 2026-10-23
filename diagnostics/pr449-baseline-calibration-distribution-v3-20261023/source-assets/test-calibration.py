"""Synthetic math/schema tests only; no renderer imports or child workloads."""
import copy,importlib.util,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent
s=importlib.util.spec_from_file_location('assessor',ROOT/'assess-calibration.py');a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
def fixture():
    inputs=[{'occurrenceId':str(i),'id':'flowchart:'+a.TAILS[i]if i<6 else'other:'+str(i),'stratum':'H27'if i<27 else'D48'}for i in range(75)]
    data={}
    for engine in ['native','elk']:
        for policy in ['off','normal']:
            for round_ in [1,2,3]:
                for role in ['baseline-A','baseline-B']:
                    data[engine,policy,round_,role]={'calls':[{'occurrenceId':x['occurrenceId'],'stratum':x['stratum'],'wallMs':10.0}for rep in range(4)for x in inputs]}
    return inputs,data
class Tests(unittest.TestCase):
    def test_exact_controls(self):
        inputs,d=fixture();v=a.assess_statistics(d,inputs);self.assertTrue(v['controlQualified']);self.assertEqual(len(v['cohorts']),36);self.assertEqual(len(v['inputs']),300)
    def test_missing_worker_null_not_win(self):
        inputs,d=fixture();del d['elk','off',2,'baseline-B'];v=a.assess_statistics(d,inputs);self.assertFalse(v['controlQualified']);self.assertTrue(any(x['BOverA']is None for x in v['cohorts']))
    def test_each_round_not_only_median(self):
        inputs,d=fixture()
        for c in d['native','off',1,'baseline-B']['calls']:c['wallMs']*=1.03
        self.assertFalse(a.assess_statistics(d,inputs)['controlQualified'])
    def test_reciprocal_faster_is_also_failure(self):
        inputs,d=fixture()
        for c in d['native','normal',3,'baseline-B']['calls']:c['wallMs']*=.95
        self.assertFalse(a.assess_statistics(d,inputs)['controlQualified'])
    def test_tail_every_round(self):
        inputs,d=fixture()
        for c in d['native','off',1,'baseline-B']['calls']:
            if c['occurrenceId']=='0':c['wallMs']*=1.06
        v=a.assess_statistics(d,inputs);self.assertFalse(v['controlQualified']);self.assertTrue(any(x['kind']=='tail-every-round-control'for x in v['failures']))
    def test_every_input_retained(self):
        inputs,d=fixture()
        for round_ in [1,2,3]:
            for c in d['elk','normal',round_,'baseline-B']['calls']:
                if c['occurrenceId']=='74':c['wallMs']*=1.06
        self.assertTrue(any(x['kind']=='input-median-control'and x['occurrenceId']=='74'for x in a.assess_statistics(d,inputs)['failures']))
    def test_ratio_not_normalized(self):
        self.assertFalse(a.healthy(.97,1.02));self.assertTrue(a.healthy(1/1.02,1.02));self.assertFalse(a.finite(True));self.assertFalse(a.finite(float('nan')))
    def test_worker_retains_all_warmups(self):
        inputs,_=fixture();job={'inputs':inputs,'policy':'off','role':'baseline-A','artifactIdentity':'x','layoutMode':'agentic','baselineSourceBinding':{'x':1},'oracleSha256':'o'}
        rows=[{'rep':rep,'stage':'prewarm'if rep<0 else'timed','occurrenceId':x['occurrenceId'],'stratum':x['stratum'],'originalId':x['id'],'oracleMatches':True,'callbackCalls':1,'wallMs':1,'cpuUserMicros':2,'cpuSystemMicros':0}for rep in [-2,-1,0,1,2,3]for x in inputs]
        d={**{k:job[k]for k in ['policy','role','artifactIdentity','layoutMode','baselineSourceBinding','oracleSha256']},'protocol':'baseline-repeatability-calibration-worker@1','status':'completed','ok':True,'node':'v24.19.0','execArgv':['--no-warnings'],'executionEnvironment':{'AGENTIC_MERMAID_SCENE_ASSERTIONS':None,'NODE_OPTIONS':''},'runtimeLinksVerified':{'before':True,'after':True},'warmupCalls':rows[:150],'calls':rows[150:]}
        self.assertEqual(len(a.validate_calls(d,job)),450)
        d['warmupCalls'][0].pop('wallMs')
        with self.assertRaises(KeyError):a.validate_calls(d,job)
    def test_no_candidate_role(self):
        text=(ROOT/'calibration-worker.mjs').read_text();self.assertIn("job.candidateSourceBinding!==undefined",text);self.assertIn("for(let rep=-2;rep<4;rep++)",text)
if __name__=='__main__':unittest.main()
