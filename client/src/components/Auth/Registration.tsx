import { useForm } from 'react-hook-form';
import React, { useContext, useEffect, useState } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';
import { ThemeContext, Spinner, Button, isDark } from '@because/client';
import { useNavigate, useOutletContext, useLocation } from 'react-router-dom';
import { useRegisterUserMutation } from '@because/data-provider/react-query';
import { loginPage } from '@because/data-provider';
import type { TRegisterUser, TError } from '@because/data-provider';
import type { TLoginLayoutContext } from '~/common';
import { useLocalize, TranslationKeys } from '~/hooks';
import { getDatApiBaseUrl } from '~/utils/datApi';
import { ErrorMessage } from './ErrorMessage';

type DatProjectOption = { _id: string; name: string };
type OrgFlatOption = {
  orgCode: string;
  orgName: string;
  orgType: string;
  depth: number;
};

/** 把 /api/v1/org/nodes 返回的嵌套树拍平，保留 depth 用于在下拉里缩进显示层级 */
function flattenOrgTree(nodes: any[], depth = 0, acc: OrgFlatOption[] = []): OrgFlatOption[] {
  for (const n of nodes || []) {
    if (n?.orgCode) {
      acc.push({
        orgCode: String(n.orgCode),
        orgName: String(n.orgName || ''),
        orgType: String(n.orgType || ''),
        depth,
      });
    }
    if (n?.children?.length) {
      flattenOrgTree(n.children, depth + 1, acc);
    }
  }
  return acc;
}

const Registration: React.FC = () => {
  const navigate = useNavigate();
  const localize = useLocalize();
  const { theme } = useContext(ThemeContext);
  const { startupConfig, startupConfigError, isFetching } = useOutletContext<TLoginLayoutContext>();

  const {
    watch,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TRegisterUser>({ mode: 'onChange' });
  const password = watch('password');

  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countdown, setCountdown] = useState<number>(3);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  // 机构选择：项目 → 机构树 → 拍平下拉。失败时静默退化为可选文本输入
  const [orgProjects, setOrgProjects] = useState<DatProjectOption[]>([]);
  const [orgProjectId, setOrgProjectId] = useState<string>('');
  const [orgOptions, setOrgOptions] = useState<OrgFlatOption[]>([]);
  const [orgLoadError, setOrgLoadError] = useState<string>('');
  const [orgCode, setOrgCode] = useState<string>('');

  // 注册页是匿名访问，DAT 的项目/机构接口允许公开调用；加载失败不阻断注册
  useEffect(() => {
    const baseEl = document.querySelector('base');
    const baseHref = baseEl?.getAttribute('href') || '/';
    const apiBase = baseHref.endsWith('/') ? baseHref.slice(0, -1) : baseHref;
    fetch(`${apiBase}/api/dat-projects`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        const list: DatProjectOption[] = (data?.projects || []).map((p: any) => ({
          _id: p._id,
          name: p.name,
        }));
        setOrgProjects(list);
        if (list.length === 1) {
          setOrgProjectId(list[0]._id);
        }
      })
      .catch((e) => {
        setOrgLoadError(e?.message || '加载项目失败');
      });
  }, []);

  useEffect(() => {
    if (!orgProjectId) {
      setOrgOptions([]);
      return;
    }
    fetch(`${getDatApiBaseUrl()}/api/v1/org/nodes?projectId=${orgProjectId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((tree) => setOrgOptions(flattenOrgTree(tree)))
      .catch((e) => {
        setOrgOptions([]);
        setOrgLoadError(e?.message || '加载机构失败');
      });
  }, [orgProjectId]);

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const token = queryParams.get('token');
  const validTheme = isDark(theme) ? 'dark' : 'light';

  // only require captcha if we have a siteKey
  const requireCaptcha = Boolean(startupConfig?.turnstile?.siteKey);

  const registerUser = useRegisterUserMutation({
    onMutate: () => {
      setIsSubmitting(true);
    },
    onSuccess: () => {
      setIsSubmitting(false);
      setCountdown(3);
      const timer = setInterval(() => {
        setCountdown((prevCountdown) => {
          if (prevCountdown <= 1) {
            clearInterval(timer);
            navigate('/c/new', { replace: true });
            return 0;
          } else {
            return prevCountdown - 1;
          }
        });
      }, 1000);
    },
    onError: (error: unknown) => {
      setIsSubmitting(false);
      if ((error as TError).response?.data?.message) {
        setErrorMessage((error as TError).response?.data?.message ?? '');
      }
    },
  });

  const renderInput = (id: string, label: TranslationKeys, type: string, validation: object) => (
    <div className="mb-4">
      <div className="relative">
        <input
          id={id}
          type={type}
          autoComplete={id}
          aria-label={localize(label)}
          {...register(
            id as 'name' | 'email' | 'username' | 'password' | 'confirm_password',
            validation,
          )}
          aria-invalid={!!errors[id]}
          className="webkit-dark-styles transition-color peer w-full rounded-2xl border border-border-light bg-surface-primary px-3.5 pb-2.5 pt-3 text-text-primary duration-200 focus:border-green-500 focus:outline-none"
          placeholder=" "
          data-testid={id}
        />
        <label
          htmlFor={id}
          className="absolute start-3 top-1.5 z-10 origin-[0] -translate-y-4 scale-75 transform bg-surface-primary px-2 text-sm text-text-secondary-alt duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:scale-100 peer-focus:top-1.5 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:px-2 peer-focus:text-green-500 rtl:peer-focus:left-auto rtl:peer-focus:translate-x-1/4"
        >
          {localize(label)}
        </label>
      </div>
      {errors[id] && (
        <span role="alert" className="mt-1 text-sm text-red-500">
          {String(errors[id]?.message) ?? ''}
        </span>
      )}
    </div>
  );

  return (
    <>
      {errorMessage && (
        <ErrorMessage>
          {localize('com_auth_error_create')} {errorMessage}
        </ErrorMessage>
      )}
      {registerUser.isSuccess && countdown > 0 && (
        <div
          className="rounded-md border border-green-500 bg-green-500/10 px-3 py-2 text-sm text-gray-600 dark:text-gray-200"
          role="alert"
        >
          {localize(
            startupConfig?.emailEnabled
              ? 'com_auth_registration_success_generic'
              : 'com_auth_registration_success_insecure',
          ) +
            ' ' +
            localize('com_auth_email_verification_redirecting', { 0: countdown.toString() })}
        </div>
      )}
      {!startupConfigError && !isFetching && (
        <>
          <form
            className="mt-6"
            aria-label="Registration form"
            method="POST"
            onSubmit={handleSubmit((data: TRegisterUser) =>
              registerUser.mutate({
                ...data,
                token: token ?? undefined,
                orgCode: orgCode || undefined,
              }),
            )}
          >
            {renderInput('name', 'com_auth_full_name', 'text', {
              required: localize('com_auth_name_required'),
              minLength: {
                value: 3,
                message: localize('com_auth_name_min_length'),
              },
              maxLength: {
                value: 80,
                message: localize('com_auth_name_max_length'),
              },
            })}
            {renderInput('username', 'com_auth_username', 'text', {
              minLength: {
                value: 2,
                message: localize('com_auth_username_min_length'),
              },
              maxLength: {
                value: 80,
                message: localize('com_auth_username_max_length'),
              },
            })}
            {renderInput('email', 'com_auth_email', 'email', {
              required: localize('com_auth_email_required'),
              minLength: {
                value: 1,
                message: localize('com_auth_email_min_length'),
              },
              maxLength: {
                value: 120,
                message: localize('com_auth_email_max_length'),
              },
              pattern: {
                value: /\S+@\S+\.\S+/,
                message: localize('com_auth_email_pattern'),
              },
            })}
            {renderInput('password', 'com_auth_password', 'password', {
              required: localize('com_auth_password_required'),
              minLength: {
                value: startupConfig?.minPasswordLength || 8,
                message: localize('com_auth_password_min_length'),
              },
              maxLength: {
                value: 128,
                message: localize('com_auth_password_max_length'),
              },
            })}
            {renderInput('confirm_password', 'com_auth_password_confirm', 'password', {
              validate: (value: string) =>
                value === password || localize('com_auth_password_not_match'),
            })}

            {/* 机构绑定（可选）：影响指标问数链路；加载失败则回退为文本输入 */}
            <div className="mb-4 space-y-2">
              {orgProjects.length > 1 && (
                <div className="relative">
                  <select
                    value={orgProjectId}
                    onChange={(e) => {
                      setOrgProjectId(e.target.value);
                      setOrgCode('');
                    }}
                    aria-label="选择项目"
                    className="webkit-dark-styles transition-color peer w-full rounded-2xl border border-border-light bg-surface-primary px-3.5 pb-2.5 pt-4 text-sm text-text-primary duration-200 focus:border-green-500 focus:outline-none"
                  >
                    <option value="">请选择您所属的项目</option>
                    {orgProjects.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {orgOptions.length > 0 ? (
                <div className="relative">
                  <select
                    value={orgCode}
                    onChange={(e) => setOrgCode(e.target.value)}
                    aria-label="选择机构"
                    className="webkit-dark-styles transition-color peer w-full rounded-2xl border border-border-light bg-surface-primary px-3.5 pb-2.5 pt-4 text-sm text-text-primary duration-200 focus:border-green-500 focus:outline-none"
                  >
                    <option value="">请选择您所属的机构</option>
                    {orgOptions.map((o) => (
                      <option key={o.orgCode} value={o.orgCode}>
                        {'　'.repeat(o.depth)}
                        {o.orgName ? `${o.orgName} (${o.orgCode})` : o.orgCode}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    value={orgCode}
                    onChange={(e) => setOrgCode(e.target.value)}
                    aria-label="机构编码"
                    placeholder=" "
                    className="webkit-dark-styles transition-color peer w-full rounded-2xl border border-border-light bg-surface-primary px-3.5 pb-2.5 pt-3 text-text-primary duration-200 focus:border-green-500 focus:outline-none"
                  />
                  <label className="absolute start-3 top-1.5 z-10 origin-[0] -translate-y-4 scale-75 transform bg-surface-primary px-2 text-sm text-text-secondary-alt duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:scale-100 peer-focus:top-1.5 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:px-2 peer-focus:text-green-500">
                    机构编码
                  </label>
                </div>
              )}
              {orgLoadError && (
                <p className="text-xs text-text-secondary">
                  机构列表加载失败：{orgLoadError}
                  ，可直接填写机构编码或留空稍后由管理员设置
                </p>
              )}
            </div>

            {startupConfig?.turnstile?.siteKey && (
              <div className="my-4 flex justify-center">
                <Turnstile
                  siteKey={startupConfig.turnstile.siteKey}
                  options={{
                    ...startupConfig.turnstile.options,
                    theme: validTheme,
                  }}
                  onSuccess={(token) => setTurnstileToken(token)}
                  onError={() => setTurnstileToken(null)}
                  onExpire={() => setTurnstileToken(null)}
                />
              </div>
            )}

            <div className="mt-6">
              <Button
                disabled={
                  Object.keys(errors).length > 0 ||
                  isSubmitting ||
                  (requireCaptcha && !turnstileToken)
                }
                type="submit"
                aria-label="Submit registration"
                variant="submit"
                className="h-12 w-full rounded-2xl"
              >
                {isSubmitting ? <Spinner /> : localize('com_auth_continue')}
              </Button>
            </div>
          </form>

          <p className="my-4 text-center text-sm font-light text-gray-700 dark:text-white">
            {localize('com_auth_already_have_account')}{' '}
            <a
              href={loginPage()}
              aria-label="Login"
              className="inline-flex p-1 text-sm font-medium text-green-600 transition-colors hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
            >
              {localize('com_auth_login')}
            </a>
          </p>
        </>
      )}
    </>
  );
};

export default Registration;
