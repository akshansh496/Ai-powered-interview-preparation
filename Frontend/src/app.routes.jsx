import React, { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import Protected from "./features/auth/components/protected";

// Lazy load route-level page components
const Login = lazy(() => import("./features/auth/pages/Login"));
const Register = lazy(() => import("./features/auth/pages/Register"));
const Home = lazy(() => import("./features/interview/pages/Home"));
const Interview = lazy(() => import("./features/interview/pages/Interview"));

// Lightweight Suspense fallback
const RouteFallback = () => (
    <div className="route-loading-fallback" style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#080B13',
        color: '#94A3B8'
    }}>
        <div style={{
            width: '32px',
            height: '32px',
            border: '3px solid rgba(6, 182, 212, 0.2)',
            borderTopColor: '#06B6D4',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite'
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
);

const withSuspense = (Component) => (
    <Suspense fallback={<RouteFallback />}>
        {Component}
    </Suspense>
);

export const router = createBrowserRouter([
    {
        path: "/login",
        element: withSuspense(<Login />)
    },
    {
        path: "/register",
        element: withSuspense(<Register />)
    },
    {
        path: "/",
        element: <Protected>{withSuspense(<Home />)}</Protected>
    },
    {
        path: "/interview/:interviewId",
        element: <Protected>{withSuspense(<Interview />)}</Protected>
    }
]); 