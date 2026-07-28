import React, { useState, useEffect, useCallback } from 'react';
import { UseFormReturn, useWatch } from 'react-hook-form';
import { useChatContext } from '~/Providers';
import { useLocalize, useAuthContext } from '~/hooks';
import { cn } from '~/utils';
import { TooltipAnchor } from '@because/client';

interface PromptOptimizeButtonProps {
  methods: UseFormReturn<{ text: string }, any>;
  textAreaRef: React.RefObject<HTMLTextAreaElement>;
  disabled?: boolean;
}

const PromptOptimizeButton: React.FC<PromptOptimizeButtonProps> = ({
  methods,
  textAreaRef,
  disabled = false,
}) => {
  const localize = useLocalize();
  const { token } = useAuthContext();
  const [isHovered, setIsHovered] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isOptimized, setIsOptimized] = useState(false);
  const [lastInputText, setLastInputText] = useState('');

  // Watch current text length to determine if we can optimize
  const currentText = useWatch({ control: methods.control, name: 'text' }) || '';
  const isInputEmpty = currentText.trim().length === 0;

  const { conversation } = useChatContext();
  const endpoint = conversation?.endpoint;
  const spec = conversation?.spec;
  const model = conversation?.model;
  const agent_id = conversation?.agent_id;
  const assistant_id = conversation?.assistant_id;

  // React to text input changes manually to clear optimized state if user types further
  useEffect(() => {
    // If the text is modified after optimization, disable the undo capability
    // unless they explicitly just hit undo. I'll check if the currentText
    // equals the expected optimized text. Wait, simple check: if text is empty, reset.
    if (isInputEmpty && isOptimized) {
      setIsOptimized(false);
      setLastInputText('');
    }
  }, [currentText, isInputEmpty, isOptimized]);

  const handleOptimize = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    if (disabled || isInputEmpty || isOptimizing) return;

    if (isOptimized) {
      // Handle Undo
      methods.setValue('text', lastInputText, { shouldValidate: true });
      setIsOptimized(false);
      setLastInputText('');
      setTimeout(() => textAreaRef.current?.focus(), 0);
      return;
    }

    // Handle Optimize
    setLastInputText(currentText);
    setIsOptimizing(true);

    try {
      const response = await fetch('/api/optimize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          text: currentText,
          endpoint,
          spec,
          model,
          agent_id,
          assistant_id,
        }),
      });

      if (!response.ok) {
        throw new Error('网络请求失败');
      }

      const data = await response.json();
      if (data.optimizedText) {
        methods.setValue('text', data.optimizedText, { shouldValidate: true });
        setIsOptimized(true);
      } else if (data.error) {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Prompt optimization failed:', error);
      // We could add a toast notification here if we wanted
    } finally {
      setIsOptimizing(false);
      setTimeout(() => textAreaRef.current?.focus(), 0);
    }
  }, [disabled, isInputEmpty, isOptimizing, isOptimized, lastInputText, currentText, endpoint, agent_id, assistant_id, methods, textAreaRef, token]);

  // Loading indicator uses base64
  const lightLoadingBG = 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAACGFjVEwAAAARAAAAANTNfiIAAAAeUExURQAAAJWZppWYpZWZpZSYpZSYppSZpZOYpZSXppSXpX7DBR0AAAABdFJOUwBA5thmAAAAEnRFWHRTb2Z0d2FyZQBlemdpZi5jb22gw7NYAAAANXRFWHRDb21tZW50AFBORyBjcmVhdGVkIHdpdGggaHR0cHM6Ly9lemdpZi5jb20vYXBuZy1tYWtlcoBjz/EAAACSSURBVFjD7ZYxEsAgDMOi/3+6WydKE0TLAJ6xDogTiNhSsD0AJMECQBG4lV7fMuchcwH6CAOX2FxaKcI3gEqUediCDN3vAJ973zg/NV4HgPUPEcqN2/dXCYAi0Ja0p0fYm8adfcx6QAGirlHWUSZJZtk204J5ENbvR5qfyh6gXyYPCKZ8KpcD1n7M4wAmAI4yugCfOQLg9VtlhwAAABpmY1RMAAAAAAAAAEAAAABAAAAAAAAAAAAAKAPoAADHlxpgAAAAlmZkQVQAAAABWMPt1ksOgCAMAFHm/pd2Z1wgtgyKCXRtX9B+pJQlA5YHQApIAZTAGeHna8lxZCygX+FKmJJnavAOkGllbo6Q65r5AHZsPMBHg9cAsPldQnpw2/lZAVAC9ZDp4RX2FP2ZbWY+kEDUZ5R1lJ0ke9kO04R9UGy+X2l+K3tA/5k8oO+UPwHmXszLBgYAOyJxALr5AuIv3gMcAAAAGmZjVEwAAAACAAAAMgAAADgAAAAHAAAAAwAoA+gBAO5mRjoAAACKZmRBVAAAAANYw+XUQQ7AIAhE0fn3v3SXTRsJDClsOlt9iSgiOUF2OgRfLBBwDXiGO6Vj80i50gbJazmtJdVHxH21THQI04T5dmqRtDe+IIWujUXRgGvANWAazrFBhEhjbX5LVkj9dOYN2Lfsv6XdMCOd3PkvnV8pVsaFWBl9nZmsPaJxot+TcOkCnDcCt8w492YAAAAaZmNUTAAAAAQAAAA1AAAANwAAAAgAAAADACgD6AEAjuKIUAAAAIxmZEFUAAAABVjD1dZLDoAgDADRJnP/O7s1EaUdsNFuyQuBfiCiFIQI+hRGYRQUGaconDvJLosk4GhlRZUzM71BbjZTKl5QbFTbS+6Uzw6VKu+HgnPN5DoQhbIMBIM6YxyC3DoyIcgFdyp/NneJM2fy/FYdypqX/SV7eXnafHaKujG/9Kb0/JhaVfxeHZvTCDI1oVlwAAAAGmZjVEwAAAAGAAAANAAAADYAAAAJAAAAAwAoA+gAANX47ogAAACEZmRBVAAAAAdYw93Uyw7AIAhEUe7//3S3TVq0MwTSOGuPL5QIMYQeyyCPBlAXQUdtihSxmlVXCdruXy/SK4oGZBSkgLzaDyAKCMfgGEFhINAVyIpnDLJpCYtoo1PFt1ioJK19OsdTLl6vr/GQnBfr/I3OT3hXzX2l1vYG2v8wivNQ/ANdPIECiR51CLIAAAAaZmNUTAAAAAgAAAA0AAAANwAAAAkAAAACACgD6AAAJwcPiAAAAHNmZEFUAAAACVjDzdZBDsAgCAVR5v6XbndNXFQdhfD3L6BRNGIzhAhv+iJUpT5Rzasll6H23TmEMRhTgNhHfDEGQRYVLCJ+oxAK3e1w5hyL29XI2H5yayWd2AGl3sEQRA2Is/lV8e5rVPbK9P4LVP1v+uQBiPkCKJD7EOcAAAAaZmNUTAAAAAoAAAA+AAAAPgAAAAEAAAABACgD6AAASt0rogAAAHZmZEFUAAAAC1jD7ZcxDsAgDAO9+P9fZqyApcaAVTU35xSBQhKAdQgLkp6O4he4dcKk/dHk5Ht9jqSiY4glNf0RetTDrtpHfHj+TR2mjmz67Zd31TdL78DDEfzZ0PvGEK11LbdBpiZDeq4k97Za+4qi2Pi/sOwGRFoHzOLzp4cAAAAaZmNUTAAAAAwAAAA+AAAAPgAAAAEAAAABACgD6AEAvgxomQAAAGdmZEFUAAAADVjD7ZcxDsAgDAM9Wer/P9wVujWHCEi+mQsIQxASwQonA/Nxr2/m++v/LOepgF3RR4R0IV1IF9K1WT9ncrjtMHN44MqXpaDPw4vBLWsc2H+a+24IIYRwxVfD+MXuW/wL1GUFkvZsWYUAAAAaZmNUTAAAAA4AAAA3AAAAOAAAAAQAAAAFACgD6AEAKjt6DgAAAG1mZEFUAAAAD1jD7dUxDoAwDATB25L/f5gOUVDEG2Qh4etHtmInSdZCXNCwuSASIiESwl1SZFecK7e5w9JabZ0dLxxkwT0PvmPV9G7ry5Rul243mUz+HHoZZYB7+LEflP7Y9pxuVJ+MGsXHN+wExU0A6bxWUb0AAAAaZmNUTAAAABAAAAA1AAAANgAAAAcAAAAEACgD6AAAeXOPbgAAAHpmZEFUAAAAEVjD7ZYxEsAwCMPQ/z/dtc1ElOLrUM/RkQvGpKopyihKEaPAYCgMBMdTk9RxIXU35qAVdg0LeaoI2j5KyRT49Zn+yWI2kNkvv2K9GbwHQ3/YCSZYMP7LJew5NEu98eyuw85MtKHNX8VyCL+mPr/dpuLxArt0AY3FJnXAAAAAGmZjVEwAAAASAAAANgAAADcAAAAHAAAABAAoA+gBAJdTMIcAAAB+ZmRBVAAAABNYw+2VQQ7AIAgE2Vv//+JeTVOrTmGbNHI1AwrsGjEbOoKE5MXkxcQowEkA1CXqqJRK7G2uCcB5UyxbOqNsYpdQpqL+rPvQF35hsZlWyGs71wlGIWzZ2ea6s6lh6xFUuBo3KTI0UKY5KvF3TmT9AJ2YvxzDno9PBcICAycPyHgAAAAaZmNUTAAAABQAAAA2AAAAOAAAAAcAAAADACgD6AAA8q2OrwAAAItmZEFUAAAAFVjD1dZBDoAwCERRZuf9T+zOqAsCnwlRtua1acu0RtRLgWqZiSnKxBRlbairEKrTg6D3VGxtbCf7jZcqiXQXZGmb0yFjk9lTNWFaCiPt2GE+eg4G0hH/6ghCzD0XWpcdIeXePrlP+HavNLfD0MoPuBHU4UtGr6/dX5fPvwTxCxaUpV9PrXcCSO62c5IAAAAaZmNUTAAAABYAAAA2AAAAOAAAAAcAAAADACgD6AEABiBsBwAAAJBmZEFUAAAAF1jD1dZBDoAgDETRWczC+5/YpSZIkQ9tQrfNS0UcRJooCxVjLmZmijIzNQv9LmJ+wwuYZuLk9oxG9XqDB+w242X1uyPmI5irvnQZOS8xQ4bzmB3jJsg4/mbqsUEw4mLKRAGjXXOcsiILvfW8X8QHTE4ADpwgo6cJPbxUy1ZuPHVMR7DqG27YvQEWEAnVrGiRCQAAABpmY1RMAAAAGAAAADYAAAA3AAAABwAAAAMAKAPoAACmwK+HAAAAi2ZkQVQAAAAZWMPd1kEOgCAMRNH597+0ayOk8BEWdGnzghCmmkwUUWUZBxma4dS8A+F4lSB9930+tFSzV79gu1luq9OtDoOuyxWMQ3c2LN11mRAkwybLBlLGGKcGITAPKUuhBoNpto3wy47s8dX+x2lfwo1fpKXAyXjbYRKOjjw7l3OWxbPcyvb84D5mMgKT1qV6jgAAABpmY1RMAAAAGgAAADMAAAA1AAAABwAAAAMAKAPoAADdWkBFAAAAk2ZkQVQAAAAbWMPd1ssKgDAQQ9Hclf//x64UQdtOQiti1h76mJmiZIRNduBXBmwENuJIdedcUzJQM6i5Utmcqnfgxi3IN3b1utVJDXOMGLZJ0lpRO87s4J4hIGVU6vseKSHuCcgI0YovWphirI9DY27KP79/09NL+qSCHk2GIRi6lbOdPSKvPYqKjdYbfdxM/VfbAVoKAqn0s7eoAAAAGmZjVEwAAAAcAAAANQAAADcAAAAIAAAAAwAoA+gAAJYyfHsAAACVZmRBVAAAAB1Yw93Wuw6AIBBEUXIb//+PrWyQhdkRCHFbPCHsAyklEVcxAs5XWAgLDdh7mSdkRR3KwbFUJVNJVo7VWB7mMFRGQUdFJthsgYqypSisRsVCOcZHhYV0ps1EH2kMyDvaYZAeRIzk59tV9lBGCqeXK3LL+tDseXO+zFl2L47Cp6tt/v9+rtr0jvmtOui1egOBmAWOIe9UUgAAABpmY1RMAAAAHgAAACwAAAAuAAAADAAAAAoAKAPoAACh9Lc0AAAAfmZkQVQAAAAfWMPV1DEOwCAMQ1HL9z90hy5FTcC/gqEe0SOKICC9Yvu1cEcL7Ge2YtTGwDOszspNaaVYE3sQF7q3dZ0Om1iGTexa27m2c23H2lWILbmnieG4ySCHcNh1fh7gnMkV7hokNqJs+EUse4PsK2BYxH7AEtA/xNqALw90BTPeJc/wAAAAGmZjVEwAAAAgAAAANQAAADcAAAAIAAAAAwAoA+gAAJVAFBoAAACRZmRBVAAAACFYw9WWMQ7AMAgD8dT//7hDpS5QZCyCqFdySgCDYsYLlwkCllOAgkkUHpVywCuWglMr5ULUC32YS8vHmRLGlNBR5iqUfRgnfoRiqtxEcU5toRhzpxCNsaOUQgyGUAqTc0hVPR+yKGqKKifXW3m1yzF2zr3ipIhTObo3Rvfh18beRE3+fn5ALfqt3oDiAtvN5oNnAAAAAElFTkSuQmCC)';
  const darkLoadingBG = 'url(data:image/png;base64,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)';

  const tooltipText = isInputEmpty
    ? '请先输入内容'
    : isOptimized
      ? '撤销'
      : '优化输入内容';

  return (
    <TooltipAnchor
      description={tooltipText}
      side="top"
    >
      <button
        type="button"
        onClick={handleOptimize}
        disabled={disabled || (isInputEmpty && !isOptimized)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={cn(
          'relative flex h-8 w-8 items-center justify-center rounded-md p-0',
          'transition-colors duration-200 outline-none',
          (!isInputEmpty || isOptimized) && !disabled && !isOptimizing
            ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600/50 text-gray-700 dark:text-gray-300'
            : 'cursor-not-allowed opacity-50 text-gray-400 dark:text-gray-500',
          isOptimizing && 'cursor-default'
        )}
        aria-label={tooltipText}
      >
        {isOptimizing ? (
          <>
            <div
              className="absolute inset-0 flex items-center justify-center dark:hidden"
              style={{ backgroundImage: lightLoadingBG, backgroundPosition: 'center', backgroundSize: '16px 16px', backgroundRepeat: 'no-repeat' }}
            />
            <div
              className="absolute inset-0 hidden items-center justify-center dark:flex"
              style={{ backgroundImage: darkLoadingBG, backgroundPosition: 'center', backgroundSize: '16px 16px', backgroundRepeat: 'no-repeat' }}
            />
          </>
        ) : isOptimized ? (
          <svg className="icon w-4 h-4" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
            <path d="M596.16 284.064H258.56l101.376-101.44a31.968 31.968 0 1 0-45.248-45.216L178.56 273.504c-11.904 11.872-18.496 27.84-18.56 44.8a63.04 63.04 0 0 0 18.56 45.28l136.128 136.16a31.904 31.904 0 0 0 45.248 0 31.968 31.968 0 0 0 0-45.248l-106.752-106.496H596.16c114.88 0 208.32 93.312 208.32 208s-93.44 208-208.32 208h-223.36a32 32 0 0 0 0 64h223.36c150.144 0 272.32-122.016 272.32-272 0-149.984-122.176-272-272.32-272" fill="currentColor"></path>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="currentColor">
            <path stroke="currentColor" strokeWidth="0.667" d="M7.34 3c.064 1.913.68 3.242 1.549 4.111.87.87 2.198 1.485 4.111 1.549v.013c-1.913.064-3.242.68-4.111 1.55-.87.868-1.485 2.198-1.549 4.11h-.014c-.064-1.912-.68-3.242-1.548-4.11-.87-.87-2.199-1.486-4.112-1.55V8.66c1.913-.064 3.242-.68 4.112-1.549.869-.87 1.484-2.198 1.548-4.111z"></path>
            <path d="M10.667 3.13c.786 0 1.308.238 1.636.567.329.328.567.85.567 1.636h.26c0-.786.238-1.308.566-1.636.329-.329.85-.567 1.637-.567v-.26c-.786 0-1.308-.238-1.636-.567-.329-.328-.567-.85-.567-1.636h-.26c0 .786-.238 1.308-.566 1.636-.329.329-.85.567-1.637.567z"></path>
          </svg>
        )}
      </button>
    </TooltipAnchor>
  );
};

export default PromptOptimizeButton;
