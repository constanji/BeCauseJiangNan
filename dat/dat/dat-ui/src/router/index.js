import { createRouter, createWebHistory } from 'vue-router'

// Layouts
import MainLayout from '@/layouts/MainLayout.vue'

// Views
import Dashboard from '@/views/Dashboard.vue'
import ProjectList from '@/views/project/ProjectList.vue'
import ProjectForm from '@/views/project/ProjectForm.vue'
import ProjectDetail from '@/views/project/ProjectDetail.vue'
import DatasourceList from '@/views/datasource/DatasourceList.vue'
import DatasourceForm from '@/views/datasource/DatasourceForm.vue'
import DatasourceDetail from '@/views/datasource/DatasourceDetail.vue'
import ChatInterface from '@/components/ChatInterface.vue'
import ContentStoreManager from '@/views/contentStore/ContentStoreManager.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: MainLayout,
      children: [
        {
          path: '',
          name: 'dashboard',
          component: Dashboard,
          meta: { breadcrumb: '仪表盘' }
        },
        // 项目管理
        {
          path: 'projects',
          name: 'projects',
          component: ProjectList,
          meta: { breadcrumb: '项目管理' }
        },
        {
          path: 'projects/new',
          name: 'project-new',
          component: ProjectForm,
          meta: { breadcrumb: '创建项目' }
        },
        {
          path: 'projects/:id',
          name: 'project-detail',
          component: ProjectDetail,
          meta: { breadcrumb: '项目详情' }
        },
        {
          path: 'projects/:id/edit',
          name: 'project-edit',
          component: ProjectForm,
          meta: { breadcrumb: '编辑项目' }
        },
        {
          path: 'projects/:projectId/datasources',
          name: 'project-datasources',
          component: DatasourceList,
          meta: { breadcrumb: '数据源' }
        },
        {
          path: 'projects/:projectId/datasources/new',
          name: 'project-datasource-new',
          component: DatasourceForm,
          meta: { breadcrumb: '添加数据源' }
        },
        // 数据源管理
        {
          path: 'datasources',
          name: 'datasources',
          component: DatasourceList,
          meta: { breadcrumb: '数据源' }
        },
        {
          path: 'datasources/new',
          name: 'datasource-new',
          component: DatasourceForm,
          meta: { breadcrumb: '添加数据源' }
        },
        {
          path: 'datasources/:id',
          name: 'datasource-detail',
          component: DatasourceDetail,
          meta: { breadcrumb: '数据源详情' }
        },
        {
          path: 'datasources/:id/edit',
          name: 'datasource-edit',
          component: DatasourceForm,
          meta: { breadcrumb: '编辑数据源' }
        },
        // 问数对话
        {
          path: 'chat',
          name: 'chat',
          component: ChatInterface,
          meta: { breadcrumb: '问数对话' }
        },
        // 内容管理
        {
          path: 'content-store',
          name: 'content-store',
          component: ContentStoreManager,
          meta: { breadcrumb: '内容管理' }
        },
      ]
    },
  ],
})

export default router
