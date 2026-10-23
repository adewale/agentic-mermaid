"""Filesystem-only stable-entry/census controls, no renderer or build."""
from pathlib import Path
from tempfile import TemporaryDirectory
import copy,json,unittest
from distribution_admission import census_distribution,admit_distribution
SPEC=json.loads((Path(__file__).resolve().parent/'distribution-admission-spec.json').read_text())
class AdmissionFixtures(unittest.TestCase):
 def fixture(self):
  t=TemporaryDirectory();self.addCleanup(t.cleanup);root=Path(t.name)/'dist';root.mkdir()
  for row in SPEC['stableFiles']:
   p=root.parent/row['path'];p.parent.mkdir(parents=True,exist_ok=True);p.write_text('fixture:'+row['path'])
  for name in ['cli-NEWHASH1.js','mcp-cli-NEWHASH2.js','server-NEWHASH3.js']:(root/name).write_text('generated fixture')
  while len(list(root.glob('*.js')))<27:(root/f'chunk-FIXTURE{len(list(root.glob("*.js")))}.js').write_text('fixture')
  while sum(p.is_file()for p in root.rglob('*'))<134:
   p=root/'assets'/f'fixture-{sum(p.is_file()for p in root.rglob("*"))}.txt';p.parent.mkdir(exist_ok=True);p.write_text('fixture')
  return root
 def admission(self,root):return admit_distribution(census_distribution(root),SPEC)
 def test_new_hashed_cli_mcp_server_names_admitted(self):
  root=self.fixture();r=self.admission(root);self.assertTrue(r['qualified']);self.assertEqual(len(SPEC['stableFiles']),17)
 def test_missing_truly_fixed_index_rejected_even_with_same_counts(self):
  root=self.fixture();(root/'index.js').rename(root/'renamed-index.js');r=self.admission(root)
  self.assertFalse(r['qualified']);self.assertEqual(r['failedChecks'][0]['missing'],['dist/index.js'])
 def test_extra_file_rejected_and_complete_census_retained(self):
  root=self.fixture();(root/'extra.txt').write_text('extra');c=census_distribution(root);r=admit_distribution(c,SPEC)
  self.assertFalse(r['qualified']);self.assertEqual(c['regularFileCount'],135);self.assertIn('dist/extra.txt',c['regularFiles'])
 def test_deleted_generated_file_rejected(self):
  root=self.fixture();next((root/'assets').iterdir()).unlink();r=self.admission(root);self.assertFalse(r['qualified']);self.assertIn('exact-distribution-file-count',[x['name']for x in r['failedChecks']])
 def test_changed_root_js_count_rejected_even_with_same_file_count(self):
  root=self.fixture();next(p for p in root.glob('chunk-*.js')).rename(root/'not-js.txt');r=self.admission(root);self.assertFalse(r['qualified']);self.assertIn('exact-root-javascript-count',[x['name']for x in r['failedChecks']])
 def test_all_failed_reasons_retained_without_short_circuit(self):
  root=self.fixture();(root/'index.js').unlink();r=self.admission(root);self.assertEqual({x['name']for x in r['failedChecks']},{'exact-distribution-file-count','exact-root-javascript-count','all-source-derived-stable-entries-present'})
 def test_census_hash_and_size_bind_every_actual_regular_file(self):
  import hashlib
  root=self.fixture();c=census_distribution(root)
  self.assertEqual(len(c['regularFiles']),134)
  for relative,row in c['regularFiles'].items():
   b=(root.parent/relative).read_bytes();self.assertEqual(row,{'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)})
 def test_symlink_is_catalogued_and_rejected_without_following(self):
  root=self.fixture();p=root/'extra-link';p.symlink_to(root/'index.js');c=census_distribution(root);self.assertIn('dist/extra-link',c['symlinks']);self.assertFalse(admit_distribution(c,SPEC)['qualified'])
 def test_missing_distribution_root_returns_explicit_failure(self):
  with TemporaryDirectory()as td:
   c=census_distribution(Path(td)/'missing');r=admit_distribution(c,SPEC);self.assertFalse(r['qualified']);self.assertEqual(r['checks'][0]['name'],'distribution-root-ordinary-directory')
if __name__=='__main__':unittest.main()
