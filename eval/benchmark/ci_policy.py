"""Mirror the local-only benchmark entry policy; report readers need no guard."""
import os


def assert_benchmark_execution_allowed():
    indicators = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'BUILDKITE', 'CIRCLECI', 'TF_BUILD', 'JENKINS_URL', 'TEAMCITY_VERSION']
    active = [key for key in indicators if os.environ.get(key, '').lower() not in ('', '0', 'false', 'no')]
    if active:
        raise RuntimeError(f"Benchmarks are excluded from CI ({', '.join(active)}). Run them in an explicit local measurement session; records can be updated without rerunning unchanged projects.")
