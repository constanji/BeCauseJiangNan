# 总览[](https://antd-design-x-vue.netlify.app/component/overview.html#总览)

`ant-design-x-vue` 是 `@ant-design/x` 的 Vue 实现，是一个专注于 Vue 生态的先进 AI 组件库，旨在简化与人工智能集成的开发过程。我们的库包括高度定制化的 AI 组件，允许开发者轻松地将对话 AI 集成到他们的应用中。除了丰富的 UI 组件，`ant-design-x-vue` 还提供了一揽子 API 解决方案，支持开发者通过令牌认证直接接入现有 AI 服务，无缝衔接与 AI 的对话和交互。无论是建立智能聊天应用、提升用户交互体验还是加快 AI 能力的集成，`ant-design-x-vue` 都是 Vue 开发者进入 AI 世界的理想伙伴。



# Bubble 对话气泡[](https://antd-design-x-vue.netlify.app/component/bubble.html#bubble-对话气泡)

用于聊天的气泡组件。

### 自定义列表内容[](https://antd-design-x-vue.netlify.app/component/bubble.html#自定义列表内容)

自定义气泡列表内容，这对于个性化定制场景非常有用。

```vue
<script setup lang="ts">
import {
  CoffeeOutlined,
  FireOutlined,
  SmileOutlined,
  UserOutlined,
} from '@ant-design/icons-vue';
import { Attachments, BubbleList, Prompts } from 'ant-design-x-vue';
import { Button, Flex, Image, Typography } from 'ant-design-vue';
import type { BubbleListProps } from 'ant-design-x-vue';
import { h, ref } from 'vue';

defineOptions({ name: 'AXBubbleListCustomSetup' });

const items = ref<BubbleListProps['items']>([
  // Normal
  {
    key: 0,
    role: 'ai',
    content: 'Normal message',
  },
  // Custom content
  {
    key: 1,
    role: 'ai',
    content: {
      imageUrl: 'https://mdn.alipayobjects.com/huamei_iwk9zp/afts/img/A*eco6RrQhxbMAAAAAAAAAAAAADgCCAQ/original',
      text: 'Ant Design X Vue',
      actionNode: 'Click Me',
    },
    messageRender: (content) => {
      return h(
        Flex,
        { gap: 'middle', align: 'center' },
        () => [
          h(Image, { height: 50, src: content?.imageUrl }),
          h(
            'span',
            { style: { fontSize: '18px', fontWeight: 'bold' } },
            content?.text
          )
        ]
      );
    },
  },
  // VNode
  {
    key: 2,
    role: 'ai',
    id: 'message_id_2',
    content: h(Typography.Text, { type: 'danger' }, () => 'VNode message'),
  },
  // Role: suggestion
  {
    key: 3,
    role: 'suggestion',
    content: [
      {
        key: '6',
        icon: h(CoffeeOutlined, { style: { color: '#964B00' } }),
        description: 'How to rest effectively after long hours of work?',
      },
      {
        key: '7',
        icon: h(SmileOutlined, { style: { color: '#FAAD14' } }),
        description: 'What are the secrets to maintaining a positive mindset?',
      },
      {
        key: '8',
        icon: h(FireOutlined, { style: { color: '#FF4D4F' } }),
        description: 'How to stay calm under immense pressure?',
      },
    ],
  },
  // Role: file
  {
    key: 4,
    role: 'file',
    content: [
      {
        uid: '1',
        name: 'excel-file.xlsx',
        size: 111111,
        description: 'Checking the data',
      },
      {
        uid: '2',
        name: 'word-file.docx',
        size: 222222,
        status: 'uploading',
        percent: 23,
      },
    ],
  },
]);

const roles: BubbleListProps['roles'] = {
  ai: {
    placement: 'start',
    typing: true,
    avatar: { icon: h(UserOutlined), style: { background: '#fde3cf' } },
    footer: (content, { key }) => {
      if (content?.actionNode) {
        return h(
          Button,
          {
            type: 'text',
            onClick: () => {
              items.value = items.value.map((item) => {
                if (item.key === key) {
                  return {
                    ...item,
                    content: {
                      ...item?.content,
                      actionNode: '🎉 Happy Ant Design X !',
                    },
                  };
                }
                return item;
              });
            }
          },
          () => content?.actionNode
        );
      }
      return null;
    },
  },
  suggestion: {
    placement: 'start',
    avatar: { icon: h(UserOutlined), style: { visibility: 'hidden' } },
    variant: 'borderless',
    messageRender: (items) => h(Prompts, { vertical: true, items, }),
  },
  file: {
    placement: 'start',
    avatar: { icon: h(UserOutlined), style: { visibility: 'hidden' } },
    variant: 'borderless',
    messageRender: (items) => h(
      Flex,
      { vertical: true, gap: 'middle' },
      () => (items as any[]).map((item) => h(
        Attachments.FileCard,
        { key: item.uid, item }
      ))
    ),
  },
};
</script>

<template>
  <BubbleList
    :roles="roles"
    :items="items"
  />
</template>
```



# Conversations 管理对话[](https://antd-design-x-vue.netlify.app/component/conversations.html#conversations-管理对话)

用于承载用户侧发送的历史对话列表。

### 分组排序[](https://antd-design-x-vue.netlify.app/component/conversations.html#分组排序)

通过 `groupable.sort` 属性对分组排序, 通过 `groupable.title` 自定义渲染分组

```vue
<script setup lang="ts">
import { CommentOutlined } from '@ant-design/icons-vue';
import { Space, theme } from 'ant-design-vue';
import { Conversations, type ConversationsProps } from 'ant-design-x-vue';
import { computed, h } from 'vue';

defineOptions({ name: 'AXConversationsGroupSortSetup' });


const items: ConversationsProps['items'] = Array.from({ length: 6 }).map((_, index) => {
  const timestamp = index <= 3 ? 1732204800000 : 1732204800000 - 60 * 60 * 24;

  return {
    key: `item${index + 1}`,
    label: `Conversation ${timestamp + index * 60 * 60}`,
    timestamp: timestamp + index * 60 * 60,
    group: index <= 3 ? 'Today' : 'Yesterday',
  };
});

const { token } = theme.useToken();

// Customize the style of the container
const style = computed(() => ({
  width: '272px',
  background: token.value.colorBgContainer,
  borderRadius: token.value.borderRadius,
}));

const groupable: ConversationsProps['groupable'] = {
  sort(a, b) {
    if (a === b) return 0;

    return a === 'Today' ? -1 : 1;
  },
  title: (group, { components: { GroupTitle } }) =>
    group ? h(
      GroupTitle,
      null,
      () => [h(Space, null, () => [h(CommentOutlined), h('span', null, group)])]
    ) : h(GroupTitle),
};
</script>
<template>
  <Conversations
    :style="style"
    :groupable="groupable"
    default-active-key="item1"
    :items="items"
  />
</template>
```



# Welcome 欢迎[](https://antd-design-x-vue.netlify.app/component/welcome.html#welcome-欢迎)

清晰传达给用户可实现的意图范围和预期功能。

### 背景定制[](https://antd-design-x-vue.netlify.app/component/welcome.html#背景定制)

自定义部分样式。

```vue
<script setup lang="ts">
import { Card, ConfigProvider, Flex, theme } from 'ant-design-vue';
import { Welcome } from 'ant-design-x-vue';

defineOptions({ name: 'AXWelcomeBackgroundSetup' });

const items: {
  algorithm: typeof theme.defaultAlgorithm;
  background: string;
}[] = [
  {
    algorithm: theme.defaultAlgorithm,
    background: 'linear-gradient(97deg, #f2f9fe 0%, #f7f3ff 100%)',
  },
  {
    algorithm: theme.darkAlgorithm,
    background:
      'linear-gradient(97deg, rgba(90,196,255,0.12) 0%, rgba(174,136,255,0.12) 100%)',
  },
];
</script>
<template>
  <Flex vertical>
    <ConfigProvider
      v-for="({ algorithm, background }, index) in items"
      :key="index"
      :theme="{ algorithm }"
    >
      <Card :style="{ borderRadius: 0 }">
        <Welcome
          :style="{ backgroundImage: background, borderStartStartRadius: 4 }"
          icon="https://mdn.alipayobjects.com/huamei_iwk9zp/afts/img/A*s5sNRo5LjfQAAAAAAAAAAAAADgCCAQ/fmt.webp"
          title="Hello, I'm Ant Design X"
          description="Base on Ant Design, AGI
        product interface solution, create a better intelligent vision~"
        />
      </Card>
    </ConfigProvider>
  </Flex>
</template>
```







# Prompts 提示集[](https://antd-design-x-vue.netlify.app/component/prompts.html#prompts-提示集)

用于显示一组与当前上下文相关的预定义的问题或建议。

### 嵌套组合[](https://antd-design-x-vue.netlify.app/component/prompts.html#嵌套组合)

嵌套组合。

```vue
<script setup lang="ts">
import { CommentOutlined, FireOutlined, HeartOutlined, ReadOutlined, RocketOutlined, SmileOutlined } from '@ant-design/icons-vue';
import { App, Card, ConfigProvider, Space, theme, message } from 'ant-design-vue';
import { Prompts, type PromptsProps } from 'ant-design-x-vue';
import { h } from 'vue';

defineOptions({ name: 'AXPromptsNestSetup' });

const renderTitle = (icon: any, title: string) => {
  return h(Space, { align: 'start' }, () => [
    icon,
    h('span', null, title)
  ]);
};

const items: PromptsProps['items'] = [
  {
    key: '1',
    label: renderTitle(h(FireOutlined, { style: { color: '#FF4D4F' } }), 'Hot Topics'),
    description: 'What are you interested in?',
    children: [
      {
        key: '1-1',
        description: `What's new in X?`,
      },
      {
        key: '1-2',
        description: `What's AGI?`,
      },
      {
        key: '1-3',
        description: `Where is the doc?`,
      },
    ],
  },
  {
    key: '2',
    label: renderTitle(h(ReadOutlined, { style: { color: '#1890FF' } }), 'Design Guide'),
    description: 'How to design a good product?',
    children: [
      {
        key: '2-1',
        icon: h(HeartOutlined),
        description: `Know the well`,
      },
      {
        key: '2-2',
        icon: h(SmileOutlined),
        description: `Set the AI role`,
      },
      {
        key: '2-3',
        icon: h(CommentOutlined),
        description: `Express the feeling`,
      },
    ],
  },
  {
    key: '3',
    label: renderTitle(h(RocketOutlined, { style: { color: '#722ED1' } }), 'Start Creating'),
    description: 'How to start a new project?',
    children: [
      {
        key: '3-1',
        label: 'Fast Start',
        description: `Install Ant Design X`,
      },
      {
        key: '3-2',
        label: 'Online Playground',
        description: `Play on the web without installing`,
      },
    ],
  },
];
</script>

<template>
  <ConfigProvider
    :theme="{
      algorithm: theme.defaultAlgorithm,
    }"
  >
    <Card :style="{ borderRadius: 0, border: 0 }">
      <Prompts
        title="Do you want?"
        :items="items"
        wrap
        :styles="{
          item: {
            flex: 'none',
            width: 'calc(30% - 6px)',
            backgroundImage: `linear-gradient(137deg, #e5f4ff 0%, #efe7ff 100%)`,
            border: 0,
          },
          subItem: {
            background: 'rgba(255,255,255,0.45)',
            border: '1px solid #FFF',
          },
        }"
        @item-click="(info) => {
          message.success(`You clicked: ${info.data.description}`);
        }"
      />
    </Card>
  </ConfigProvider>
</template>
```



# Sender 输入框[](https://antd-design-x-vue.netlify.app/component/sender.html#sender-输入框)

用于聊天的输入框组件。

### 聚焦[](https://antd-design-x-vue.netlify.app/component/sender.html#聚焦)

使用 `ref` 选项控制聚焦。

```vue
<script setup lang="ts">
import { App, Button, Flex } from 'ant-design-vue';
import { Sender } from 'ant-design-x-vue';
import { ref } from 'vue';

defineOptions({ name: 'AXSenderFocusSetup' });

const senderRef = ref<InstanceType<typeof Sender> | null>(null);

const focusStart = () => {
  senderRef.value?.focus({ cursor: 'start' });
};

const focusEnd = () => {
  senderRef.value?.focus({ cursor: 'end' });
};

const focusAll = () => {
  senderRef.value?.focus({ cursor: 'all' });
};

const focusPreventScroll = () => {
  senderRef.value?.focus({ preventScroll: true });
};

const blur = () => {
  senderRef.value?.blur();
};
</script>
<template>
  <App>
    <Flex
      wrap="wrap"
      :gap="12"
    >
      <Button @click="focusStart">
        Focus at first
      </Button>
      <Button @click="focusEnd">
        Focus at last
      </Button>
      <Button @click="focusAll">
        Focus to select all
      </Button>
      <Button @click="focusPreventScroll">
        Focus prevent scroll
      </Button>
      <Button @click="blur">
        Blur
      </Button>
      <Sender
        ref="senderRef"
        default-value="Hello, welcome to use Ant Design X!"
      />
    </Flex>
  </App>
</template>
```



# Attachments 输入附件[](https://antd-design-x-vue.netlify.app/component/attachments.html#attachments-输入附件)

用于展示一组附件信息集合。

### 文件卡片[](https://antd-design-x-vue.netlify.app/component/attachments.html#文件卡片)

单独的文件卡片，用于一些展示场景。

```vue
<script setup lang="ts">
import { Flex } from 'ant-design-vue';
import { Attachments } from 'ant-design-x-vue';

defineOptions({ name: 'AXAttachmentFiles' });

const filesList = [
  {
    uid: '1',
    name: 'excel-file.xlsx',
    size: 111111,
  },
  {
    uid: '2',
    name: 'word-file.docx',
    size: 222222,
  },
  {
    uid: '3',
    name: 'image-file.png',
    size: 333333,
  },
  {
    uid: '4',
    name: 'pdf-file.pdf',
    size: 444444,
  },
  {
    uid: '5',
    name: 'ppt-file.pptx',
    size: 555555,
  },
  {
    uid: '6',
    name: 'video-file.mp4',
    size: 666666,
  },
  {
    uid: '7',
    name: 'audio-file.mp3',
    size: 777777,
  },
  {
    uid: '8',
    name: 'zip-file.zip',
    size: 888888,
  },
  {
    uid: '9',
    name: 'markdown-file.md',
    size: 999999,
    description: 'Custom description here',
  },
  {
    uid: '10',
    name: 'image-file.png',
    thumbUrl: 'https://zos.alipayobjects.com/rmsportal/jkjgkEfvpUPVyRjUImniVslZfWPnJuuZ.png',
    url: 'https://zos.alipayobjects.com/rmsportal/jkjgkEfvpUPVyRjUImniVslZfWPnJuuZ.png',
    size: 123456,
  },
];
</script>

<template>
  <Flex
    vertical
    gap="middle"
  >
    <Attachments.FileCard
      v-for="(file, index) in filesList"
      :key="index"
      :item="file"
    />
  </Flex>
</template>
```



# Suggestion 快捷指令[](https://antd-design-x-vue.netlify.app/component/suggestion.html#suggestion-快捷指令)

用于给予用户快捷提示的组件。

### 自定义[](https://antd-design-x-vue.netlify.app/component/suggestion.html#自定义)

根据输入动态展示建议项的多标签示例。

```vue
<script setup lang="ts">
import { Select } from 'ant-design-vue';
import { Suggestion } from 'ant-design-x-vue';
import { ref } from 'vue';

defineOptions({ name: 'AXSuggestionTriggerSetup' });

const uuid = ref(0);
const tags = ref<string[]>([]);
const value = ref('');
</script>
<template>
  <Suggestion
    :items="(info) => [{ label: `Trigger by '${info}'`, value: String(info) }]"
    @select="(info) => {
      uuid += 1;
      tags = [...tags, `Cell_${uuid}`];
      value = value.replace(info, '');
    }"
  >
    <template #default="{ onTrigger, onKeyDown }">
      <Select
        :value="tags"
        :style="{ width: '100%' }"
        mode="tags"
        :open="false"
        :search-value="value"
        placeholder="可任意输入 / 与 # 多次获取建议"
        @change="(nextTags) => {
          if ((nextTags as string[]).length < tags.length) {
            tags = nextTags as string[];
          }
        }"
        @search="(nextVal) => {
          value = nextVal;
        }"
        @keydown="(e) => {
          if (e.key === '/' || e.key === '#') {
            onTrigger(e.key);
          }
          onKeyDown(e);
        }"
      />
    </template>
  </Suggestion>
</template>
```



# ThoughtChain 思维链[](https://antd-design-x-vue.netlify.app/component/thought-chain.html#thoughtchain-思维链)

思维链组件用于可视化和追踪 Agent 对 Actions 和 Tools 的调用链。

### tooltip 提示[](https://antd-design-x-vue.netlify.app/component/thought-chain.html#tooltip-提示)

配置 `tooltip` 可开启对思维链节点内容区域的 tooltip 提示功能

```vue
<script setup lang="ts">
import { h } from 'vue';
import { MoreOutlined } from '@ant-design/icons-vue';
import { Button, Card } from 'ant-design-vue';
import { ThoughtChain, type ThoughtChainProps } from 'ant-design-x-vue';

defineOptions({ name: 'AXThoughtChainBasic' });

const items: ThoughtChainProps['items'] = [
  {
    title: 'Thought Chain Item Title',
    description: 'Description of the thought chain item',
    extra: h(Button, { type: 'text', icon: h(MoreOutlined) }),
  },
  {
    title: 'Visible tooltip： Thought Chain Item Title',
    description: 'Description of the thought chain item',
    extra: h(Button, { type: 'text', icon: h(MoreOutlined) }),
    tooltip: true,
  },
  {
    title: 'Thought Chain Item Title',
    description: 'Description of the thought chain item',
    extra: h(Button, { type: 'text', icon: h(MoreOutlined) }),
    tooltip: {
      titleConfig: {
        title: 'Custom title tooltip',
      },
      descriptionConfig: {
        title: 'Custom description tooltip',
      },
    },
  },
  {
    title: 'Hidden description tooltip',
    description: 'Description of the thought chain item',
    extra: h(Button, { type: 'text', icon: h(MoreOutlined) }),
    tooltip: {
      descriptionConfig: {
        open: false,
        title: 'This text does not display the description tooltip',
      },
    },
  },
];
</script>
<template>
  <Card style="width: 250px">
    <ThoughtChain :items="items" />
  </Card>
</template>
```



# Actions 操作列表[](https://antd-design-x-vue.netlify.app/component/actions.html#actions-操作列表)

用于快速配置一些 AI 场景下所需要的操作按钮/功能。

### 使用变体[](https://antd-design-x-vue.netlify.app/component/actions.html#使用变体)

使用 `variant` 属性来设置不同的样式变体。

```vue
<script setup lang="ts">
import { CopyOutlined, RedoOutlined } from '@ant-design/icons-vue';
import { message as messageAnt } from 'ant-design-vue';
import { Actions, type ActionsProps } from 'ant-design-x-vue';
import { h } from 'vue';

defineOptions({ name: 'AXActionsVariantSetup' });

const [message, contextHolder] = messageAnt.useMessage();

const actionItems: ActionsProps['items'] = [
  {
    key: 'retry',
    icon: h(RedoOutlined),
    label: 'Retry',
  },
  {
    key: 'copy',
    icon: h(CopyOutlined),
    label: 'Copy',
  },
];

const onClick: ActionsProps['onClick'] = ({ keyPath }) => {
  // Logic for handling click events
  message.success(`you clicked ${keyPath.join(',')}`);
};
</script>

<template>
  <context-holder />
  <Actions :items="actionItems" :on-click="onClick" variant="border" />
</template>
```



# useXChat 数据管理[](https://antd-design-x-vue.netlify.app/component/use-x-chat.html#usexchat-数据管理)

配合 Agent hook 进行对话数据管理。

### 流式输出[](https://antd-design-x-vue.netlify.app/component/use-x-chat.html#流式输出)

使用流式输出更新内容。

```vue
<script setup lang="ts">
import { UserOutlined } from '@ant-design/icons-vue';
import { Flex } from 'ant-design-vue';
import { Bubble, Sender, useXAgent, useXChat } from 'ant-design-x-vue';
import { ref } from 'vue';

defineOptions({ name: 'AXUseXChatStreamSetup' });

const roles: (typeof Bubble.List)['roles'] = {
  ai: {
    placement: 'start',
    avatar: { icon: UserOutlined, style: { background: '#fde3cf' } },
  },
  local: {
    placement: 'end',
    avatar: { icon: UserOutlined, style: { background: '#87d068' } },
  },
};

const content = ref('');
const senderLoading = ref(false);

// Agent for request
const [ agent ] = useXAgent<string, { message: string }, string>({
  request: async ({ message }, { onSuccess, onUpdate }) => {
    senderLoading.value = true;
    const fullContent = `Streaming output instead of Bubble typing effect. You typed: ${message}`;
    let currentContent = '';

    const id = setInterval(() => {
      currentContent = fullContent.slice(0, currentContent.length + 2);
      onUpdate(currentContent);
      if (currentContent === fullContent) {
        senderLoading.value = false;
        clearInterval(id);
        onSuccess([fullContent]);
      }
    }, 100);
  },
});

// Chat messages
const { onRequest, messages } = useXChat({
  agent: agent.value,
});
</script>
<template>
  <Flex
    vertical
    gap="middle"
  >
    <Bubble.List
      :roles="roles"
      :style="{ maxHeight: 300 }"
      :items="messages.map(({ id, message, status }) => ({
        key: id,
        role: status === 'local' ? 'local' : 'ai',
        content: message,
      }))"
    />
    <Sender
      :loading="senderLoading"
      :value="content"
      :on-change="(v) => content = v"
      :on-submit="(nextContent) => {
        onRequest(nextContent);
        content = '';
      }"
    />
  </Flex>
</template>
```



# XStream 流[](https://antd-design-x-vue.netlify.app/component/x-stream.html#xstream-流)

转换可读数据流。

### 默认协议 - SSE[](https://antd-design-x-vue.netlify.app/component/x-stream.html#默认协议-sse)

> SSE - https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events

XStream 默认的 `transformStream` 是用于 SSE 协议的流转换器。`readableStream` 接收一个 `new ReadableStream(...)` 实例，常见的如 `await fetch(...).body`

```vue
<script setup lang="ts">
import { TagsOutlined } from '@ant-design/icons-vue';
import { Button, Flex } from 'ant-design-vue';
import { Bubble, ThoughtChain, XStream } from 'ant-design-x-vue';
import { computed, ref, h } from 'vue';

defineOptions({ name: 'AXXStreamDefaultProtocolSetup' });

const contentChunks = ['He', 'llo', ', w', 'or', 'ld!'];

function mockReadableStream() {
  const sseChunks: string[] = [];

  for (let i = 0; i < contentChunks.length; i++) {
    const sseEventPart = `event: message\ndata: {"id":"${i}","content":"${contentChunks[i]}"}\n\n`;
    sseChunks.push(sseEventPart);
  }

  return new ReadableStream({
    async start(controller) {
      for (const chunk of sseChunks) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

const lines = ref<Record<string, string>[]>([]);
const content = computed(() =>
  lines.value.map((line) => JSON.parse(line.data).content).join(''),
);

async function readStream() {
  // 🌟 Read the stream
  for await (const chunk of XStream({
    readableStream: mockReadableStream(),
  })) {
    console.log(chunk);
    lines.value = [...lines.value, chunk];
  }
}
</script>
<template>
  <Flex :gap="8">
    <div>
      <!-- -------------- Emit -------------- -->
      <Button
        type="primary"
        :style="{ marginBottom: '16px' }"
        @click="readStream"
      >
        Mock Default Protocol - SSE
      </Button>
      <!-- -------------- Content Concat -------------- -->
      <Bubble
        v-if="content"
        :content="content"
      />
    </div>
    <div>
      <ThoughtChain
        :items="
          lines.length
            ? [
              {
                title: 'Mock Default Protocol - Log',
                status: 'success',
                icon: h(TagsOutlined),
                content: h('pre', { style: { overflow: 'scroll' } }, [
                  lines.map((i) => h('code', { key: i.data }, i.data)),
                ]),
              },
            ]
            : []
        "
      />
    </div>
  </Flex>
</template>
<style scoped>
pre {
  width: 'auto';
  margin: 0;

  code {
    display: block;
    padding: 12px 16px;
    font-size: 14px;
  }
}
</style>
```



# XRequest 请求[](https://antd-design-x-vue.netlify.app/component/x-request.html#xrequest-请求)

## 何时使用[](https://antd-design-x-vue.netlify.app/component/x-request.html#何时使用)

- 向符合 OpenAI 标准的 LLM 发起请求。

### 基础[](https://antd-design-x-vue.netlify.app/component/x-request.html#基础)

该示例说明如何使用 XRequest 对符合 OpenAI 标准的 LLM 发起 fetch 请求 ，请拷贝代码且在 DEV 环境用实际的值替换 BASE_URL, PATH, MODEL, API_KEY 来使用。

```vue
<script setup lang="ts">
import { LoadingOutlined, TagsOutlined } from '@ant-design/icons-vue';
import { Button, Descriptions, Flex } from 'ant-design-vue';
import { ThoughtChain, type ThoughtChainItem, XRequest } from 'ant-design-x-vue';
import { ref, h } from 'vue';

defineOptions({ name: 'AXXRequestBasicSetup' });

/**
 * 🔔 Please replace the BASE_URL, PATH, MODEL, API_KEY with your own values.
 */
 const BASE_URL = 'https://api.example.com';
const PATH = '/chat';
const MODEL = 'gpt-3.5-turbo';
// const API_KEY = '';

const exampleRequest = XRequest({
  baseURL: BASE_URL + PATH,
  model: MODEL,

  /** 🔥🔥 Its dangerously! */
  // dangerouslyApiKey: API_KEY
});

const status = ref<ThoughtChainItem['status']>();
const lines = ref<Record<string, string>[]>([]);

async function request() {
  status.value = 'pending';

  await exampleRequest.value.create(
    {
      messages: [{ role: 'user', content: 'hello, who are u?' }],
      stream: true,
      agentId: 111,
    },
    {
      onSuccess: (messages) => {
        status.value = 'success';
        console.log('onSuccess', messages);
      },
      onError: (error) => {
        status.value = 'error';
        console.error('onError', error);
      },
      onUpdate: (msg) => {
        lines.value = [...lines.value, msg];
        console.log('onUpdate', msg);
      },
    },
  );
}
</script>
<template>
  <Flex
    align="start"
    gap="16"
    :style="{ overflow: 'auto' }"
  >
    <Button
      type="primary"
      :disabled="status === 'pending'"
      @click="request"
    >
      {{ `Request - ${BASE_URL + PATH}` }}
    </Button>
    <ThoughtChain
      :items="[
        {
          title: 'Request Log',
          status: status,
          icon: status === 'pending' ? h(LoadingOutlined) : h(TagsOutlined),
          description:
            status === 'error' &&
            exampleRequest.baseURL === BASE_URL + PATH &&
            'Please replace the BASE_URL, PATH, MODEL, API_KEY with your own values.',
          content: h(Descriptions, { column: 1 }, () => [
            h(Descriptions.Item, { label: 'Status' }, status || '-'),
            h(Descriptions.Item, { label: 'Update Times' }, lines.length.toString())
          ]),
        },
      ]"
    />
  </Flex>
</template>
```





# XProvider 全局化配置[](https://antd-design-x-vue.netlify.app/component/x-provider.html#xprovider-全局化配置)

为组件提供统一的全局化配置。

## 代码演示[](https://antd-design-x-vue.netlify.app/component/x-provider.html#代码演示)

### 使用[](https://antd-design-x-vue.netlify.app/component/x-provider.html#使用)

如何使用

```vue
<script setup lang="ts">
import { AlipayCircleOutlined, BulbOutlined, CheckCircleOutlined, GithubOutlined, LoadingOutlined, SmileOutlined, UserOutlined } from '@ant-design/icons-vue';
import { Card, Divider, Flex, Radio, Typography } from 'ant-design-vue';
import { Bubble, Conversations, Prompts, Sender, Suggestion, ThoughtChain, XProvider, type XProviderProps } from 'ant-design-x-vue';
import { ref, h } from 'vue';

defineOptions({ name: 'AXProviderUseSetup' });

const value = ref('');
const direction = ref<XProviderProps['direction']>('ltr');

const directionChange = (e: Event) => {
  direction.value = (e.target as HTMLInputElement).value as XProviderProps['direction']; 
}

const conversationItemList = [
  {
    key: '1',
    label: 'Conversation - 1',
    icon: h(GithubOutlined),
  },
  {
    key: '2',
    label: 'Conversation - 2',
    icon: h(AlipayCircleOutlined),
  },
];

const bubbleItemList = [
  {
    key: '1',
    placement: 'end',
    content: 'Hello Ant Design X!',
    avatar: { icon: h(UserOutlined) },
  },
  {
    key: '2',
    content: 'Hello World!',
  },
  {
    key: '3',
    content: '',
    loading: true,
  },
];

const promptItemList = [
  {
    key: '1',
    icon: h(BulbOutlined, { style: { color: '#FFD700' } }),
    label: 'Ignite Your Creativity',
  },
  {
    key: '2',
    icon: h(SmileOutlined, { style: { color: '#52C41A' } }),
    label: 'Tell me a Joke',
  },
];

const thoughtChainItemList = [
  {
    title: 'Hello Ant Design X!',
    status: 'success',
    description: 'status: success',
    icon: h(CheckCircleOutlined),
    content: 'Ant Design X help you build AI chat/platform app as ready-to-use 📦.',
  },
  {
    title: 'Hello World!',
    status: 'success',
    description: 'status: success',
    icon: h(CheckCircleOutlined),
  },
  {
    title: 'Pending...',
    status: 'pending',
    description: 'status: pending',
    icon: h(LoadingOutlined),
  },
];
</script>
<template>
  <div>
    <Flex
      :gap="12"
      :style="{ marginBottom: '16px' }" 
      align="center"
    >
      <Typography.Text>Direction:</Typography.Text>
      <Radio.Group
        :value="direction"
        @change="directionChange"
      >
        <Radio.Button value="ltr">
          LTR
        </Radio.Button>
        <Radio.Button value="rtl">
          RTL
        </Radio.Button>
      </Radio.Group>
    </Flex>
    <Card>
      <XProvider :direction="direction">
        <Flex
          :style="{ height: '500px' }"
          gap="12"
        >
          <Conversations
            :style="{ width: '200px' }"
            default-active-key="1"
            :items="conversationItemList"
          />
          <Divider
            type="vertical"
            :style="{ height: '100%' }"
          />
          <Flex
            vertical
            :style="{ flex: 1 }"
            :gap="8"
          >
            <Bubble.List
              :style="{ flex: 1 }"
              :items="bubbleItemList"
            />
            <Prompts
              :items="promptItemList"
            />
            <Suggestion
              :items="[{ label: 'Write a report', value: 'report' }]"
            >
              <template #default="{ onTrigger, onKeyDown }">
                <Sender
                  :value="value"
                  :on-change="(nextVal) => {
                    if (nextVal === '/') {
                      onTrigger();
                    } else if (!nextVal) {
                      onTrigger(false);
                    }
                    value = nextVal;
                  }"
                  :on-key-down="onKeyDown"
                  placeholder="Type &quot;/&quot; to trigger suggestion"
                />
              </template>
            </Suggestion>
          </Flex>
          <Divider
            type="vertical"
            :style="{ height: '100%' }"
          />
          <ThoughtChain
            :style="{ width: '200px' }"
            :items="thoughtChainItemList"
          />
        </Flex>
      </XProvider>
    </Card>
  </div>
</template>
```





# 演示

## 独立式

```vue
<script setup lang="ts">
import type { AttachmentsProps, BubbleListProps, ConversationsProps, PromptsProps } from 'ant-design-x-vue'
import type { VNode } from 'vue'
import {
  CloudUploadOutlined,
  CommentOutlined,
  EllipsisOutlined,
  FireOutlined,
  HeartOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReadOutlined,
  ShareAltOutlined,
  SmileOutlined,
} from '@ant-design/icons-vue'
import { Badge, Button, Flex, Space, Typography, theme } from 'ant-design-vue'
import {
  Attachments,
  Bubble,
  Conversations,
  Prompts,
  Sender,
  useXAgent,
  useXChat,
  Welcome,
} from 'ant-design-x-vue'
import { computed, h, ref, watch } from 'vue'

const { token } = theme.useToken()

const styles = computed(() => {
  return {
    'layout': {
      'width': '100%',
      'min-width': '970px',
      'height': '722px',
      'border-radius': `${token.value.borderRadius}px`,
      'display': 'flex',
      'background': `${token.value.colorBgContainer}`,
      'font-family': `AlibabaPuHuiTi, ${token.value.fontFamily}, sans-serif`,
    },
    'menu': {
      'background': `${token.value.colorBgLayout}80`,
      'width': '280px',
      'height': '100%',
      'display': 'flex',
      'flex-direction': 'column',
    },
    'conversations': {
      'padding': '0 12px',
      'flex': 1,
      'overflow-y': 'auto',
    },
    'chat': {
      'height': '100%',
      'width': '100%',
      'max-width': '700px',
      'margin': '0 auto',
      'box-sizing': 'border-box',
      'display': 'flex',
      'flex-direction': 'column',
      'padding': `${token.value.paddingLG}px`,
      'gap': '16px',
    },
    'messages': {
      flex: 1,
    },
    'placeholder': {
      'padding-top': '32px',
      'text-align': 'left',
      'flex': 1,
    },
    'sender': {
      'box-shadow': token.value.boxShadow,
    },
    'logo': {
      'display': 'flex',
      'height': '72px',
      'align-items': 'center',
      'justify-content': 'start',
      'padding': '0 24px',
      'box-sizing': 'border-box',
    },
    'logo-img': {
      width: '24px',
      height: '24px',
      display: 'inline-block',
    },
    'logo-span': {
      'display': 'inline-block',
      'margin': '0 8px',
      'font-weight': 'bold',
      'color': token.value.colorText,
      'font-size': '16px',
    },
    'addBtn': {
      background: '#1677ff0f',
      border: '1px solid #1677ff34',
      width: 'calc(100% - 24px)',
      margin: '0 12px 24px 12px',
    },
  } as const
})

defineOptions({ name: 'PlaygroundIndependentSetup' })

const sleep = () => new Promise(resolve => setTimeout(resolve, 500))

function renderTitle(icon: VNode, title: string) {
  return h(Space, { align: 'start' }, () => [icon, h('span', title)])
}

const defaultConversationsItems = [
  {
    key: '0',
    label: 'What is Ant Design X?',
  },
]

const placeholderPromptsItems: PromptsProps['items'] = [
  {
    key: '1',
    label: renderTitle(h(FireOutlined, { style: { color: '#FF4D4F' } }), 'Hot Topics'),
    description: 'What are you interested in?',
    children: [
      {
        key: '1-1',
        description: `What's new in X?`,
      },
      {
        key: '1-2',
        description: `What's AGI?`,
      },
      {
        key: '1-3',
        description: `Where is the doc?`,
      },
    ],
  },
  {
    key: '2',
    label: renderTitle(h(ReadOutlined, { style: { color: '#1890FF' } }), 'Design Guide'),
    description: 'How to design a good product?',
    children: [
      {
        key: '2-1',
        icon: h(HeartOutlined),
        description: `Know the well`,
      },
      {
        key: '2-2',
        icon: h(SmileOutlined),
        description: `Set the AI role`,
      },
      {
        key: '2-3',
        icon: h(CommentOutlined),
        description: `Express the feeling`,
      },
    ],
  },
]

const senderPromptsItems: PromptsProps['items'] = [
  {
    key: '1',
    description: 'Hot Topics',
    icon: h(FireOutlined, { style: { color: '#FF4D4F' } }),
  },
  {
    key: '2',
    description: 'Design Guide',
    icon: h(ReadOutlined, { style: { color: '#1890FF' } }),
  },
]

const roles: BubbleListProps['roles'] = {
  ai: {
    placement: 'start',
    typing: { step: 5, interval: 20 },
    styles: {
      content: {
        borderRadius: '16px',
      },
    },
  },
  local: {
    placement: 'end',
    variant: 'shadow',
  },
}

// ==================== State ====================
const headerOpen = ref(false)
const content = ref('')
const conversationsItems = ref(defaultConversationsItems)
const activeKey = ref(defaultConversationsItems[0].key)
const attachedFiles = ref<AttachmentsProps['items']>([])
const agentRequestLoading = ref(false)

// ==================== Runtime ====================
const [agent] = useXAgent<string, { message: string }, string>({
  request: async ({ message }, { onSuccess }) => {
    agentRequestLoading.value = true
    await sleep()
    agentRequestLoading.value = false
    onSuccess([`Mock success return. You said: ${message}`])
  },
})

const { onRequest, messages, setMessages } = useXChat({
  agent: agent.value,
})

watch(activeKey, () => {
  if (activeKey.value !== undefined) {
    setMessages([])
  }
}, { immediate: true })

// ==================== Event ====================
function onSubmit(nextContent: string) {
  if (!nextContent)
    return
  onRequest(nextContent)
  content.value = ''
}

const onPromptsItemClick: PromptsProps['onItemClick'] = (info) => {
  onRequest(info.data.description as string)
}

function onAddConversation() {
  conversationsItems.value = [
    ...conversationsItems.value,
    {
      key: `${conversationsItems.value.length}`,
      label: `New Conversation ${conversationsItems.value.length}`,
    },
  ]
  activeKey.value = `${conversationsItems.value.length}`
}

const onConversationClick: ConversationsProps['onActiveChange'] = (key) => {
  activeKey.value = key
}

const handleFileChange: AttachmentsProps['onChange'] = info => attachedFiles.value = info.fileList

// ==================== Nodes ====================
const placeholderNode = computed(() => h(
  Space,
  { direction: "vertical", size: 16, style: styles.value.placeholder },
  () => [
    h(
      Welcome,
      {
        variant: "borderless",
        icon: "https://mdn.alipayobjects.com/huamei_iwk9zp/afts/img/A*s5sNRo5LjfQAAAAAAAAAAAAADgCCAQ/fmt.webp",
        title: "Hello, I'm Ant Design X",
        description: "Base on Ant Design, AGI product interface solution, create a better intelligent vision~",
        extra: h(Space, {}, () => [h(Button, { icon: h(ShareAltOutlined) }), h(Button, { icon: h(EllipsisOutlined) })]),
      }
    ),
    h(
      Prompts,
      {
        title: "Do you want?",
        items: placeholderPromptsItems,
        styles: {
          list: {
            width: '100%',
          },
          item: {
            flex: 1,
          },
        },
        onItemClick: onPromptsItemClick,
      }
    )
  ]
))

const items = computed<BubbleListProps['items']>(() => {
  if (messages.value.length === 0) {
    return [{ content: placeholderNode, variant: 'borderless' }]
  }
  return messages.value.map(({ id, message, status }) => ({
    key: id,
    loading: status === 'loading',
    role: status === 'local' ? 'local' : 'ai',
    content: message,
  }))
})
</script>

<template>
  <div :style="styles.layout">
    <div :style="styles.menu">
      <!-- 🌟 Logo -->
      <div :style="styles.logo">
        <img
          src="https://mdn.alipayobjects.com/huamei_iwk9zp/afts/img/A*eco6RrQhxbMAAAAAAAAAAAAADgCCAQ/original"
          draggable="false"
          alt="logo"
          :style="styles['logo-img']"
        >
        <span :style="styles['logo-span']">Ant Design X Vue</span>
      </div>

      <!-- 🌟 添加会话 -->
      <Button
        type="link"
        :style="styles.addBtn"
        @click="onAddConversation"
      >
        <PlusOutlined />
        New Conversation
      </Button>

      <!-- 🌟 会话管理 -->
      <Conversations
        :items="conversationsItems"
        :style="styles.conversations"
        :active-key="activeKey"
        @active-change="onConversationClick"
      />
    </div>

    <div :style="styles.chat">
      <!-- 🌟 消息列表 -->
      <Bubble.List
        :items="items"
        :roles="roles"
        :style="styles.messages"
      />

      <!-- 🌟 提示词 -->
      <Prompts
        :items="senderPromptsItems"
        @item-click="onPromptsItemClick"
      />

      <!-- 🌟 输入框 -->
      <Sender
        :value="content"
        :style="styles.sender"
        :loading="agentRequestLoading"
        @submit="onSubmit"
        @change="value => content = value"
      >
        <template #prefix>
          <Badge :dot="attachedFiles.length > 0 && !headerOpen">
            <Button
              type="text"
              @click="() => headerOpen = !headerOpen"
            >
              <template #icon>
                <PaperClipOutlined />
              </template>
            </Button>
          </Badge>
        </template>

        <template #header>
          <Sender.Header
            title="Attachments"
            :open="headerOpen"
            :styles="{ content: { padding: 0 } }"
            @open-change="open => headerOpen = open"
          >
            <Attachments
              :before-upload="() => false"
              :items="attachedFiles"
              @change="handleFileChange"
            >
              <template #placeholder="type">
                <Flex
                  v-if="type && type.type === 'inline'"
                  align="center"
                  justify="center"
                  vertical
                  gap="2"
                >
                  <Typography.Text style="font-size: 30px; line-height: 1;">
                    <CloudUploadOutlined />
                  </Typography.Text>
                  <Typography.Title
                    :level="5"
                    style="margin: 0; font-size: 14px; line-height: 1.5;"
                  >
                    Upload files
                  </Typography.Title>
                  <Typography.Text type="secondary">
                    Click or drag files to this area to upload
                  </Typography.Text>
                </Flex>
                <Typography.Text v-if="type && type.type === 'drop'">
                  Drop file here
                </Typography.Text>
              </template>
            </Attachments>
          </Sender.Header>
        </template>
      </Sender>
    </div>
  </div>
</template>
```

## 助手式

```vue
<script setup lang="ts">
import {
  AppstoreAddOutlined,
  CloseOutlined,
  CloudUploadOutlined,
  CommentOutlined,
  CopyOutlined,
  DislikeOutlined,
  LikeOutlined,
  PaperClipOutlined,
  PlusOutlined,
  AppstoreOutlined,
  ReloadOutlined,
  ScheduleOutlined,
} from '@ant-design/icons-vue';
import {
  Attachments,
  type Attachment,
  Bubble,
  Conversations,
  type Conversation,
  Prompts,
  Sender,
  Suggestion,
  Welcome,
  useXAgent,
  useXChat,
  theme,
} from 'ant-design-x-vue';
import { Button, Image, Popover, Space, Spin, message } from 'ant-design-vue';
import { ref, watch, onMounted, computed, h } from 'vue';

defineOptions({ name: 'PlaygroundCopilotSetup' });

type BubbleDataType = {
  role: string;
  content: string;
};

const MOCK_SESSION_LIST = [
  {
    key: '5',
    label: 'New session',
    group: 'Today',
  },
  {
    key: '4',
    label: 'What has Ant Design X upgraded?',
    group: 'Today',
  },
  {
    key: '3',
    label: 'New AGI Hybrid Interface',
    group: 'Today',
  },
  {
    key: '2',
    label: 'How to quickly install and import components?',
    group: 'Yesterday',
  },
  {
    key: '1',
    label: 'What is Ant Design X?',
    group: 'Yesterday',
  },
];
const MOCK_SUGGESTIONS = [
  { label: 'Write a report', value: 'report' },
  { label: 'Draw a picture', value: 'draw' },
  {
    label: 'Check some knowledge',
    value: 'knowledge',
    children: [
      { label: 'About React', value: 'react' },
      { label: 'About Ant Design', value: 'antd' },
    ],
  },
];
const MOCK_QUESTIONS = [
  'What has Ant Design X upgraded?',
  'What components are in Ant Design X?',
  'How to quickly install and import components?',
];
const AGENT_PLACEHOLDER = 'Generating content, please wait...';


const attachmentsRef = ref<InstanceType<typeof Attachments>>(null);
const abortController = ref<AbortController>(null);

// ==================== State ====================

const messageHistory = ref<Record<string, any>>({});

const sessionList = ref<Conversation[]>(MOCK_SESSION_LIST);
const curSession = ref(sessionList.value[0].key);

const attachmentsOpen = ref(false);
const files = ref<Attachment[]>([]);

const inputValue = ref('');


// ==================== Runtime ====================

/**
 * 🔔 Please replace the BASE_URL, PATH, MODEL, API_KEY with your own values.
 */
const [agent] = useXAgent<BubbleDataType>({
  baseURL: 'https://api.x.ant.design/api/model-url-path',
  model: 'model-name',
  dangerouslyApiKey: 'Bearer sk-xxxxxxxxxxxxxxxxxxxx',
});

const loading = agent.value.isRequesting();

const { messages, onRequest, setMessages } = useXChat({
  agent: agent.value,
  requestFallback: (_, { error }) => {
    if (error.name === 'AbortError') {
      return {
        content: 'Request is aborted',
        role: 'assistant',
      };
    }
    return {
      content: 'Request failed, please try again!',
      role: 'assistant',
    };
  },
  transformMessage: (info) => {
    const { originMessage, currentMessage } = info || {};
    let currentContent = '';
    let currentThink = '';
    try {
      if (currentMessage?.data && !currentMessage?.data.includes('DONE')) {
        const message = JSON.parse(currentMessage?.data);
        currentThink = message?.choices?.[0]?.delta?.reasoning_content || '';
        currentContent = message?.choices?.[0]?.delta?.content || '';
      }
    } catch (error) {
      console.error(error);
    }

    let content = '';

    if (!originMessage?.content && currentThink) {
      content = `<think>${currentThink}`;
    } else if (
      originMessage?.content?.includes('<think>') &&
      !originMessage?.content.includes('</think>') &&
      currentContent
    ) {
      content = `${originMessage?.content}</think>${currentContent}`;
    } else {
      content = `${originMessage?.content || ''}${currentThink}${currentContent}`;
    }

    return {
      content: content,
      role: 'assistant',
    };
  },
  resolveAbortController: (controller) => {
    abortController.value = controller;
  },
});
watch(curSession, () => {
  if (curSession.value !== undefined) {
    setMessages(messageHistory.value?.[curSession.value] || []);
  } else {
    setMessages([]);
  }
}, { immediate: true });

watch(
  () => messages.value,
  () => {
    // history mock
    if (messages.value?.length) {
      messageHistory.value = {
        ...messageHistory.value,
        [curSession.value]: messages.value,
      }
    }
  }
);


// ==================== Event ====================
const handleUserSubmit = (val: string) => {
  onRequest({
    stream: true,
    message: { content: val, role: 'user' },
  });

  // session title mock
  if (sessionList.value.find((i) => i.key === curSession.value)?.label === 'New session') {
    const tempList = sessionList.value.map((i) => (i.key !== curSession.value ? i : { ...i, label: val?.slice(0, 20) }));
    sessionList.value = tempList
  }
};

const onPasteFile = (_: File, files: FileList) => {
  for (const file of Array.from(files)) {
    attachmentsRef.value?.upload(file);
  }
  attachmentsOpen.value = true;
};

const createNewSession = () => {
  if (agent.value.isRequesting()) {
    message.error(
      'Message is Requesting, you can create a new conversation after request done or abort it right now...',
    );
    return;
  }

  if (messages.value?.length) {
    const timeNow = new Date().getTime().toString();
    try {
      abortController.value?.abort();
    } catch (error) {
      console.error(error);
    }
    // The abort execution will trigger an asynchronous requestFallback, which may lead to timing issues.
    // In future versions, the sessionId capability will be added to resolve this problem.
    setTimeout(() => {
      sessionList.value = [
        { key: timeNow, label: 'New session', group: 'Today' },
        ...sessionList.value,
      ]
      curSession.value = timeNow;
    }, 100);
  } else {
    message.error('It is now a new conversation.');
  }
}

const changeConversation = async (val: string) => {
  try {
    abortController.value?.abort();
  } catch (error) {
    console.error(error); 
  }
  // The abort execution will trigger an asynchronous requestFallback, which may lead to timing issues.
  // In future versions, the sessionId capability will be added to resolve this problem.
  setTimeout(() => {
    curSession.value = val;
  }, 100);
}

const setCopilotOpen = (val: boolean) => copilotOpen.value = val;


// ==================== Style ====================
const { token } = theme.useToken();
const styles = computed(() => {
  return {
    copilotChat: {
      width: '400px',
      display: 'flex',
      flexDirection: 'column',
      background: token.value.colorBgContainer,
      color: token.value.colorText,
    },
    // chatHeader 样式
    chatHeader: {
      height: '52px',
      boxSizing: 'border-box',
      borderBottom: `1px solid ${token.value.colorBorder}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 10px 0 16px',
    },
    headerTitle: {
      'font-weight': 600,
      'font-size': '15px',
    },
    headerButton: {
      width: '32px',
      height: '32px',
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'center',
      'font-size': '18px',
    },
    conversations: {
      width: '300px',
      '& .ant-conversations-list': {
        paddingInlineStart: 0,
      },
    },
    // chatList 样式
    chatList: {
      overflow: 'auto',
      'padding-block': '16px',
      flex: 1,
    },
    chatWelcome: {
      'margin-inline': '16px',
      padding: '12px 16px',
      'border-radius': '2px 12px 12px 12px',
      'background': token.value.colorBgTextHover,
      'margin-bottom': '16px',
    },
    loadingMessage: {
      'background-image': 'linear-gradient(90deg, #ff6b23 0%, #af3cb8 31%, #53b6ff 89%)',
      'background-size': '100% 2px',
      'background-repeat': 'no-repeat',
      'background-position': 'bottom',
    },
    // chatSend 样式
    chatSend: {
      padding: '12px'
    },
    sendAction: {
      display: 'flex',
      'align-items': 'center',
      'margin-bottom': '12px',
      gap: '8px',
    },
    speechButton: {
      'font-size': '18px',
      color: `${token.value.colorText} !important`,
    },
  } as const;
});
const workareaStyles = computed(() => {
  return {
    copilotWrapper: {
      'min-width': '970px',
      height: '100vh',
      display: 'flex',
    },
    workarea: {
      flex: 1,
      background: token.value.colorBgLayout,
      display: 'flex',
      flexDirection: 'column',
    },
    workareaHeader: {
      'box-sizing': 'border-box',
      height: '52px',
      display: 'flex',
      alignItems: 'center',
      'justify-content': 'space-between',
      padding: '0 48px 0 28px',
      'border-bottom': `1px solid ${token.value.colorBorder}`,
    },
    headerTitle: {
      'font-weight': 600,
      'font-size': '15px',
      'color': token.value.colorText,
      'display': 'flex',
      'align-items': 'center',
      'gap': '8px',
    },
    headerButton: {
      'background-image': 'linear-gradient(78deg, #8054f2 7%, #3895da 95%)',
      'border-radius': '12px',
      height: '24px',
      width: '93px',
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'center',
      color: '#fff',
      cursor: 'pointer',
      'font-size': '12px',
      'font-weight': 600,
      transition: 'all 0.3s',
      '&:hover': {
        'opacity': 0.8,
      },
    },
    workareaBody: {
      flex: 1,
      padding: '16px',
      background: token.value.colorBgContainer,
      borderRadius: '16px',
      minHeight: 0,
    },
    bodyContent: {
      overflow: 'auto',
      height: '100%',
      'padding-right': '10px',
    },
    bodyText: {
      color: token.value.colorText,
      padding: '8px'
    },
  } as const;
});

// ==================== State =================
const copilotOpen = ref<boolean>(true)

const roles: (typeof Bubble.List)['roles'] = {
  assistant: {
    placement: 'start',
    footer: h('div', {style:{ display: 'flex' }}, [
      h('Button', {type: 'text', size: 'small', icon: h(ReloadOutlined), onClick: () => {}}),
      h('Button', {type: 'text', size: 'small', icon: h(CopyOutlined), onClick: () => {}}),
      h('Button', {type: 'text', size:'small', icon: h(LikeOutlined), onClick: () => {}}),
      h('Button', {type: 'text', size:'small', icon: h(DislikeOutlined), onClick: () => {}}),
    ]),
    loadingRender: () => h(
      Space,
      {},
      [
        h(Spin, {size: 'small'}, []),
        AGENT_PLACEHOLDER,
      ]
    )
  },
  user: { placement: 'end' },
}
</script>

<template>
  <div :style="workareaStyles.copilotWrapper">
    <!-- 左侧工作区 -->
    <div :style="workareaStyles.workarea">
      <div :style="workareaStyles.workareaHeader">
        <div :style="workareaStyles.headerTitle">
          <img
            src="https://mdn.alipayobjects.com/huamei_iwk9zp/afts/img/A*eco6RrQhxbMAAAAAAAAAAAAADgCCAQ/original"
            :draggable="false"
            alt="logo"
            :width="20"
            :height="20"
          >
          Ant Design X
        </div>
        <div
          v-if="!copilotOpen"
          :style="workareaStyles.headerButton"
          @click="setCopilotOpen(true)"
        >
          ✨ AI Copilot
        </div>
      </div>

      <div
        :style="{ ...workareaStyles.workareaBody, margin: copilotOpen ? '16px' : '16px 48px' }"
      >
        <div :style="workareaStyles.bodyContent">
          <Image
            src="https://mdn.alipayobjects.com/huamei_iwk9zp/afts/img/A*48RLR41kwHIAAAAAAAAAAAAADgCCAQ/fmt.webp"
            :preview="false"
          />
          <div :style="workareaStyles.bodyText">
            <h4>What is the RICH design paradigm?</h4>
            <div>
              RICH is an AI interface design paradigm we propose, similar to how the WIMP paradigm
              relates to graphical user interfaces.
            </div>
            <br>
            <div>
              The ACM SIGCHI 2005 (the premier conference on human-computer interaction) defined
              that the core issues of human-computer interaction can be divided into three levels:
            </div>
            <ul>
              <li>
                Interface Paradigm Layer: Defines the design elements of human-computer
                interaction interfaces, guiding designers to focus on core issues.
              </li>
              <li>
                User model layer: Build an interface experience evaluation model to measure the
                quality of the interface experience.
              </li>
              <li>
                Software framework layer: The underlying support algorithms and data structures
                for human-computer interfaces, which are the contents hidden behind the front-end
                interface.
              </li>
            </ul>
            <div>
              The interface paradigm is the aspect that designers need to focus on and define the
              most when a new human-computer interaction technology is born. The interface
              paradigm defines the design elements that designers should pay attention to, and
              based on this, it is possible to determine what constitutes good design and how to
              achieve it.
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- 右侧对话区 -->
    <div :style="{ ...styles.copilotChat, display: copilotOpen ? 'flex' : 'none' }">
      <!-- 对话区 - header -->
      <!-- {chatHeader} -->
      <div :style="styles.chatHeader">
        <div :style="styles.headerTitle">
          ✨ AI Copilot
        </div>
        <Space :size="0">
          <Button
            type="text"
            :icon="h(PlusOutlined)"
            :style="styles.headerButton"
            @click="createNewSession"
          />
          <Popover
            placement="bottom"
            :overlay-style="{ padding: 0, maxHeight: 600 }"
          >
            <template #content>
              <Conversations
                :items="sessionList?.map((i) =>
                  i.key === curSession ? { ...i, label: `[current] ${i.label}` } : i,
                )"
                :active-key="curSession"
                groupable
                :styles="{...styles.conversations, item: { padding: '0 8px' } }"
                @active-change="changeConversation"
              />
            </template>
            <Button
              type="text"
              :icon="h(CommentOutlined)"
              :style="styles.headerButton"
            />
          </Popover>
          <Button
            type="text"
            :icon="h(CloseOutlined)"
            :style="styles.headerButton"
            @click="setCopilotOpen(false)"
          />
        </Space>
      </div>
      <!-- 对话区 - 消息列表 -->
      <div :style="styles.chatList">
        <Bubble.List
          v-if="messages?.length"
          :style="{ height: '100%', paddingInline: '16px' }"
          :items="messages?.map((i) => ({
            ...i.message,
            styles: {
              content: i.status === 'loading' ? styles.loadingMessage : {},
            },
            loading: i.status === 'loading',
            typing: i.status === 'loading' ? { step: 5, interval: 20, suffix: h('span', '💗') } : false,
          }))"
          :roles="roles"
        />
        <template v-else>
          <Welcome
            variant="borderless"
            title="👋 Hello, I'm Ant Design X"
            description="Base on Ant Design, AGI product interface solution, create a better intelligent vision~"
            :style="styles.chatWelcome"
          />
          <Prompts
            vertical
            title="I can help："
            :items="MOCK_QUESTIONS.map((i) => ({ key: i, description: i }))"
            :style="{
              'margin-inline': '16px',
            }"
            :styles="{
              title: { fontSize: 14 },
            }"
            @item-click="(info) => handleUserSubmit(info?.data?.description as string)"
          />
        </template>
      </div>

      <!-- 对话区 - 输入框 -->
      <!-- {chatSender} -->
      <div :style="styles.chatSend">
        <div :style="styles.sendAction">
          <Button
            :icon="h(ScheduleOutlined)"
            @click="handleUserSubmit('What has Ant Design X upgraded?')"
          >
            Upgrades
          </Button>
          <Button
            :icon="h(AppstoreOutlined)"
            @click="handleUserSubmit('What component assets are available in Ant Design X?')"
          >
            Components
          </Button>
          <Button :icon="h(AppstoreAddOutlined)">
            More
          </Button>
        </div>
        <!-- 输入框 -->
      
        <Suggestion
          :items="MOCK_SUGGESTIONS"
          @select="(itemVal) => inputValue = `[${itemVal}]:`"
        >
          <template #default="{ onTrigger, onKeyDown }">
            <Sender
              :loading="loading"
              :value="inputValue"
              allow-speech
              placeholder="Ask or input / use skills"
              @change="(v) => {
                onTrigger(v === '/');
                inputValue = v;
              }"
              @submit="() => {
                handleUserSubmit(inputValue);
                inputValue = '';
              }"
              @cancel="() => {
                try {
                  abortController?.abort();
                } catch (error) {
                  console.error(error); 
                }
              }"
              @key-down="onKeyDown"
              @paste-file="onPasteFile"
            >
              <template #header>
                <Sender.Header
                  title="Upload File"
                  :styles="{ content: { padding: 0 } }"
                  :open="attachmentsOpen"
                  force-render
                  @open-change="val => attachmentsOpen = val"
                >
                  <Attachments
                    ref="attachmentsRef"
                    :before-upload="() => false"
                    :items="files"
                    :placeholder="(type) =>
                      type === 'drop'
                        ? { title: 'Drop file here' }
                        : {
                          icon: h(CloudUploadOutlined),
                          title: 'Upload files',
                          description: 'Click or drag files to this area to upload',
                        }"
                    @change="({ fileList }) => files = fileList"
                  />
                </Sender.Header>
              </template>
              <template #prefix>
                <Button
                  type="text"
                  :icon="h(PaperClipOutlined, {style: { fontSize: '18px' }})"
                  @click="attachmentsOpen = !attachmentsOpen"
                />
              </template>
              <template #actions="{info: {components: {SendButton, LoadingButton, SpeechButton}}}">
                <div :style="{ display: 'flex', alignItems: 'center', gap: 4 }">
                  <component
                    :is="SpeechButton"
                    :style="styles.speechButton"
                  />
                  <component
                    :is="LoadingButton"
                    v-if="loading"
                    type="default"
                  />
                  <component
                    :is="SendButton"
                    v-else
                    type="primary"
                  />
                </div>
              </template>
            </Sender>
          </template>
        </Suggestion>
      </div>
    </div>
  </div>
</template>
```

