import { GithubLogoIcon } from '@phosphor-icons/react';
import { useDashboard } from '@irdashies/context';
import { GITHUB_REPOSITORY_URL } from '@irdashies/types';

const UPSTREAM_URL = 'https://github.com/tariknz/irdashies';

export const AboutSettings = () => {
  const { version } = useDashboard();

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="mb-5 border-b border-slate-700 pb-5 pt-1 text-xl font-semibold tracking-tight text-white">
            About
          </h2>
          <p className="text-slate-300">
            Tearoff is an open-source sim racing dashboards and overlays
            application for iRacing and Le Mans Ultimate.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold">Version</h3>
          <p className="text-slate-300">{version}</p>
        </div>

        <div className="flex flex-col gap-4">
          <h3 className="text-lg font-semibold">Connect</h3>

          <a
            href={GITHUB_REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors w-fit"
          >
            <GithubLogoIcon size={24} weight="bold" />
            <span>GitHub Repository</span>
          </a>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold">Credits</h3>
          <p className="text-slate-300">
            Tearoff is a fork of{' '}
            <a
              href={UPSTREAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-white transition-colors"
            >
              irDashies
            </a>{' '}
            by Tarik Alani and its contributors, released under the MIT License.
          </p>
        </div>

        <div className="flex flex-col gap-2 mb-2">
          <h3 className="text-lg font-semibold">Privacy</h3>
          <p className="text-slate-300">
            Tearoff does not collect usage analytics. This build has no
            analytics key, so no usage, system or error data is sent.
          </p>
        </div>
      </div>
    </div>
  );
};
