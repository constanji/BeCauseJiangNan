import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuthContext } from "~/hooks";
import { Prompts } from "@ant-design/x";
import type { PromptsProps } from "@ant-design/x";
import { ConfigProvider, theme } from "antd";
import {
  BulbOutlined,
  RocketOutlined,
  SearchOutlined,
  BarChartOutlined,
  QuestionCircleOutlined,
  ThunderboltOutlined,
  StarOutlined,
  FireOutlined,
} from "@ant-design/icons";
import { motion } from "framer-motion";

// Icon mapping for prompts
const ICON_MAP: Record<string, React.ReactNode> = {
  BulbOutlined: <BulbOutlined style={{ color: "#FFD700" }} />,
  RocketOutlined: <RocketOutlined style={{ color: "#722ED1" }} />,
  SearchOutlined: <SearchOutlined style={{ color: "#1890FF" }} />,
  BarChartOutlined: <BarChartOutlined style={{ color: "#52C41A" }} />,
  QuestionCircleOutlined: (
    <QuestionCircleOutlined style={{ color: "#FA8C16" }} />
  ),
  ThunderboltOutlined: <ThunderboltOutlined style={{ color: "#EB2F96" }} />,
  StarOutlined: <StarOutlined style={{ color: "#FAAD14" }} />,
  FireOutlined: <FireOutlined style={{ color: "#FF4D4F" }} />,
};

interface DatasourcePrompt {
  _id: string;
  datasourceId: string;
  label: string;
  description?: string;
  content: string;
  icon?: string;
  iconColor?: string;
  sortOrder: number;
  enabled: boolean;
}

export default function PromptsPanel() {
  const { token } = useAuthContext();

  const [prompts, setPrompts] = useState<DatasourcePrompt[]>([]);
  const [selectedDatasourceId, setSelectedDatasourceId] = useState<
    string | null
  >(null);

  // Get API base
  const getApiBase = useCallback(() => {
    const baseEl = document.querySelector("base");
    const baseHref = baseEl?.getAttribute("href") || "/";
    return baseHref.endsWith("/") ? baseHref.slice(0, -1) : baseHref;
  }, []);

  // Fetch prompts for datasource
  const fetchPrompts = useCallback(
    async (datasourceId: string) => {
      try {
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
        const response = await fetch(
          `${getApiBase()}/api/datasource-prompts?datasourceId=${datasourceId}&includeDisabled=true`,
          { method: "GET", headers, credentials: "include" },
        );
        if (response.ok) {
          const data = await response.json();
          setPrompts(data.prompts || []);
        } else {
          setPrompts([]);
        }
      } catch (error) {
        console.error("Error fetching prompts:", error);
        setPrompts([]);
      }
    },
    [getApiBase, token],
  );

  // Monitor localStorage for datasource changes
  useEffect(() => {
    const checkDatasource = () => {
      const rawValue = localStorage.getItem("lastDataSourceId");
      let datasourceId: string | null = null;
      if (rawValue) {
        try {
          datasourceId = JSON.parse(rawValue);
        } catch {
          datasourceId = rawValue;
        }
      }
      if (datasourceId && datasourceId !== selectedDatasourceId) {
        setSelectedDatasourceId(datasourceId);
        fetchPrompts(datasourceId);
      } else if (!datasourceId && selectedDatasourceId) {
        setSelectedDatasourceId(null);
        setPrompts([]);
      }
    };

    checkDatasource();

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "lastDataSourceId") {
        checkDatasource();
      }
    };
    window.addEventListener("storage", handleStorageChange);
    const interval = setInterval(checkDatasource, 1000);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, [selectedDatasourceId, fetchPrompts]);

  // Convert prompts to ant-design-x format
  const promptItems: PromptsProps["items"] = useMemo(() => {
    return prompts.map((prompt) => ({
      key: prompt._id,
      description: prompt.content, // Place the actual text in the description field for ant-design-x Prompts, leaving label blank means no bold title
    }));
  }, [prompts]);

  // Handle prompt click
  const handlePromptClick = useCallback(
    (info: { data: { key?: string } }) => {
      const prompt = prompts.find((p) => p._id === info.data.key);
      if (prompt) {
        const textarea = document.querySelector(
          'textarea[data-testid="text-input"]',
        ) as HTMLTextAreaElement;
        if (textarea) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            "value",
          )?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(textarea, prompt.content);
            const event = new Event("input", { bubbles: true });
            textarea.dispatchEvent(event);
            textarea.focus();
          }
        }
      }
    },
    [prompts],
  );

  if (promptItems.length === 0) {
    return null;
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: document.documentElement.classList.contains("dark")
          ? theme.darkAlgorithm
          : theme.defaultAlgorithm,
        token: {
          colorBgContainer: "transparent",
          colorText: "rgba(255, 255, 255, 0.85)",
          colorTextDescription: "rgba(255, 255, 255, 0.65)",
        },
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.215, 0.61, 0.355, 1], delay: 0.1 }}
        className="w-full max-w-xl mx-auto px-4 pb-2 [&_.ant-prompts-desc]:!text-gray-800 dark:[&_.ant-prompts-desc]:!text-[rgba(255,255,255,0.85)]"
      >
        <Prompts
          key={selectedDatasourceId || 'prompts'}
          items={promptItems}
          wrap
          styles={{
            list: {
              gap: "8px",
              display: "flex",
              flexWrap: "wrap",
              width: "100%",
            },
            item: {
              flex: "1 1 auto",
              minWidth: "140px",
              maxWidth: promptItems.length === 1 ? "100%" : "calc(50% - 4px)",
              background: "rgba(255, 255, 255, 0.06)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "all 0.2s ease",
              padding: "10px 14px",
              fontSize: "13px",
            },
          }}
          onItemClick={handlePromptClick}
        />
      </motion.div>
    </ConfigProvider>
  );
}
