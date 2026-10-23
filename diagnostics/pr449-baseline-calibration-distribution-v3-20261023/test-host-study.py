"""Source/metadata-only fixtures. No renderer, build or population process."""
import ast
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('host_study',ROOT/'host-study.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ProtocolFixtures(unittest.TestCase):
    def persist(self, times, *, large_output=False):
        with tempfile.TemporaryDirectory() as td:
            out=Path(td);log=out/'x.log';log.write_bytes(b'')
            job={'status':'complete','log':str(log)};record={'jobs':[job]};writes=[]
            def save(_,value):writes.append(json.loads(json.dumps(value)))
            with patch.object(module.time,'monotonic',side_effect=times),patch.object(module,'save',side_effect=save),patch.object(module,'output_size',return_value=2147483649 if large_output else 0):
                module.persist_preflight_slot(out,record,job,0,600)
            return job,writes
    def test_slow_positive_write_fails_slot(self):
        job,writes=self.persist([119,120.001,120.001])
        self.assertEqual(writes[0]['jobs'][0]['status'],'complete')
        self.assertEqual(job['status'],'failed');self.assertEqual(len(writes),2)
        self.assertEqual(job['error']['type'],'PostPersistenceBoundaryFailure')
    def test_exact_boundary_is_allowed(self):
        job,writes=self.persist([119,120,120])
        self.assertEqual(job['status'],'complete');self.assertEqual(len(writes),1)
    def test_terminal_output_cap_fails(self):
        job,writes=self.persist([1,2,2],large_output=True)
        self.assertEqual(job['status'],'failed');self.assertEqual(len(writes),2)
    def test_shared_boundary_fails(self):
        job,writes=self.persist([119,120,600.001])
        self.assertEqual(job['status'],'failed')
    def test_relocation_preserves_timing_and_arithmetic_bodies(self):
        tree=ast.parse((ROOT/'host-study.py').read_text())
        decl=next(x for x in tree.body if isinstance(x,ast.FunctionDef)and x.name=='declare')
        begin=next(i for i,x in enumerate(decl.body)if isinstance(x,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='original'for t in x.targets))
        end=next(i for i,x in enumerate(decl.body)if isinstance(x,ast.Expr)and isinstance(x.value,ast.Call)and isinstance(x.value.func,ast.Attribute)and x.value.func.attr=='write_text'and i>begin)
        with tempfile.TemporaryDirectory()as td:
            out=Path(td);runtime=out/'calibration-harness';runtime.mkdir();portable=out/'portable-oracles'
            (out/'portable-origin.json').write_text('{}')
            scope={'ROOT':ROOT,'out':out,'runtime':runtime,'portable':portable,'sha':module.sha,'Path':Path}
            exec(compile(ast.Module(body=decl.body[begin:end+1],type_ignores=[]),'EXACT_SOURCE_RELOCATION_ONLY','exec'),scope)
            old=ast.parse(scope['original']);new=ast.parse(scope['derived'])
            def func(t,n):return next(x for x in t.body if isinstance(x,ast.FunctionDef)and x.name==n)
            for name in ['validate_plan','physical','run','save']:
                self.assertEqual(ast.dump(func(old,name)),ast.dump(func(new,name)),name)
            self.assertEqual(len(scope['replacements']),5)
            self.assertNotIn('/workspace/',scope['derived'])
    def test_worker_and_assessor_are_unchanged(self):
        meta=json.loads((ROOT/'HISTORICAL-METHOD.json').read_text())
        for name in ['calibration-worker.mjs','assess-calibration.py']:
            self.assertEqual(module.sha(ROOT/'source-assets'/name),meta['sourceOrigins'][name]['sha256'])
    def test_capture_clock_starts_before_plan_load(self):
        src=ast.get_source_segment((ROOT/'host-study.py').read_text(),next(x for x in ast.parse((ROOT/'host-study.py').read_text()).body if isinstance(x,ast.FunctionDef)and x.name=='capture'))
        self.assertLess(src.index('started=time.monotonic()'),src.index("plan=load(out/'preflight-plan.json')"))

if __name__=='__main__':unittest.main()
