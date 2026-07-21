'use client';

import { useState } from 'react';
import Image from 'next/image';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

export default function LoginPage() {
  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (result.success) {
        console.log('طھظ… طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ ط¨ظ†ط¬ط§ط­:', result);
        
        // طھظˆط¬ظٹظ‡ ط§ظ„ظ…ط³طھط®ط¯ظ… ط¥ظ„ظ‰ ط§ظ„ظ†ط¸ط§ظ… ط§ظ„ظ…ظ†ط§ط³ط¨
        if (result.systems && result.systems.length > 0) {
          const firstSystem = result.systems[0];
          console.log('طھظˆط¬ظٹظ‡ ط¥ظ„ظ‰ ط§ظ„ظ†ط¸ط§ظ…:', firstSystem);
          
          // طھظˆط¬ظٹظ‡ ط­ط³ط¨ ظ†ظˆط¹ ط§ظ„ظ†ط¸ط§ظ…
          switch (firstSystem.code) {
            case 'STUDENT_AFFAIRS':
              window.location.href = '/student-affairs';
              break;
            case 'EXAM_COMMITTEE':
            case 'exam-committee':
              window.location.href = '/examinationadministration';
              break;
            case 'ANESTHESIA':
            case 'anesthesia':
              window.location.href = '/anesthesia';
              break;
            case 'XRAYS':
            case 'xrays':
              window.location.href = '/xrays';
              break;
            case 'DENTAL_INDUSTRY':
            case 'dentalindustry':
              window.location.href = '/dentalindustry';
              break;
            case 'ACCOUNTS':
            case 'accounts':
              window.location.href = '/accounts';
              break;
            case 'CONSTRUCTION':
            case 'construction':
              window.location.href = '/construction';
              break;
            case 'OIL':
            case 'oil':
              window.location.href = '/oil';
              break;
            case 'PHYSICS':
            case 'physics':
              window.location.href = '/physics';
              break;
            case 'OPTICS':
            case 'optics':
              window.location.href = '/optics';
              break;
            case 'HEALTH':
            case 'health':
              window.location.href = '/health';
              break;
            case 'EMERGENCY':
            case 'emergency':
            case 'RGENCY':
            case 'rgency':
              window.location.href = '/emergency';
              break;
            case 'THERAPY':
            case 'therapy':
              window.location.href = '/therapy';
              break;
            case 'CYBER':
            case 'cyber':
              window.location.href = '/cyber';
              break;
            case 'ACCOUNTING':
              window.location.href = '/accounts';
              break;
            default:
              alert(`ط§ظ„ظ†ط¸ط§ظ… ${firstSystem.name_ar} ط؛ظٹط± ظ…طھط§ط­ ط­ط§ظ„ظٹط§ظ‹`);
          }
        }
      } else {
        alert(result.message || 'ظپط´ظ„ ظپظٹ طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„');
      }
    } catch (error) {
      console.error('ط®ط·ط£ ظپظٹ طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„:', error);
      alert('ط­ط¯ط« ط®ط·ط£ ظپظٹ ط§ظ„ط§طھطµط§ظ„ ط¨ط§ظ„ط®ط§ط¯ظ…');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 flex items-center justify-center p-4 relative">
      {/* ط®ظ„ظپظٹط© طھط¹ظƒط³ ط§ظ„ط¹ظ„ظ… ظˆط§ظ„ظ…ط¹ط±ظپط© */}
      <div className="absolute inset-0 overflow-hidden">
        {/* ط£ط´ظƒط§ظ„ ظ‡ظ†ط¯ط³ظٹط© طھط¹ظƒط³ ط§ظ„ط¨ظ†ظٹط© ط§ظ„ط£ظƒط§ط¯ظٹظ…ظٹط© */}
        <div className="absolute top-20 right-20 w-32 h-32 bg-blue-200/30 rotate-45 rounded-lg transform animate-pulse"></div>
        <div className="absolute top-40 left-32 w-24 h-24 bg-indigo-200/40 rotate-12 rounded-lg transform animate-pulse"></div>
        <div className="absolute bottom-32 right-40 w-28 h-28 bg-purple-200/30 -rotate-12 rounded-lg transform animate-pulse"></div>
        
        {/* ط®ط·ظˆط· طھط¹ظƒط³ ط§ظ„طھط¯ط±ط¬ ط§ظ„ط£ظƒط§ط¯ظٹظ…ظٹ */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-300/50 to-transparent"></div>
        <div className="absolute bottom-0 right-0 w-full h-1 bg-gradient-to-l from-transparent via-indigo-300/50 to-transparent"></div>
        
        {/* ظ†ظ‚ط§ط· طھط¹ظƒط³ ط§ظ„ظ…ط¹ط±ظپط© */}
        <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-blue-400/60 rounded-full animate-ping"></div>
        <div className="absolute top-1/3 right-1/3 w-1.5 h-1.5 bg-indigo-400/60 rounded-full animate-ping" style={{animationDelay: '0.5s'}}></div>
        <div className="absolute bottom-1/4 left-1/3 w-2.5 h-2.5 bg-purple-400/60 rounded-full animate-ping" style={{animationDelay: '1s'}}></div>
        <div className="absolute bottom-1/3 right-1/4 w-1 h-1 bg-blue-500/60 rounded-full animate-ping" style={{animationDelay: '1.5s'}}></div>
        
        {/* ط£ط´ظƒط§ظ„ طھط¹ظƒط³ ط§ظ„ظƒطھط¨ ظˆط§ظ„ظ…ط¹ط±ظپط© */}
        <div className="absolute top-1/2 left-10 w-16 h-20 bg-gradient-to-b from-blue-200/40 to-indigo-200/40 rounded-sm transform rotate-12 opacity-60"></div>
        <div className="absolute top-1/2 left-16 w-16 h-20 bg-gradient-to-b from-indigo-200/40 to-purple-200/40 rounded-sm transform rotate-6 opacity-60"></div>
        <div className="absolute top-1/2 left-22 w-16 h-20 bg-gradient-to-b from-purple-200/40 to-blue-200/40 rounded-sm transform -rotate-6 opacity-60"></div>
        
        {/* ط®ط·ظˆط· طھط¹ظƒط³ ط§ظ„طھظ‚ط¯ظ… ط§ظ„ط£ظƒط§ط¯ظٹظ…ظٹ */}
        <div className="absolute top-1/4 right-10 w-40 h-0.5 bg-gradient-to-l from-blue-300/60 to-transparent transform rotate-12"></div>
        <div className="absolute bottom-1/4 left-10 w-32 h-0.5 bg-gradient-to-r from-indigo-300/60 to-transparent transform -rotate-12"></div>
        
        {/* ط£ط´ظƒط§ظ„ طھط¹ظƒط³ ط§ظ„ط´ظ‡ط§ط¯ط§طھ ظˆط§ظ„ط¯ط±ط¬ط§طھ */}
        <div className="absolute top-1/6 right-1/4 w-12 h-12 border-2 border-blue-300/40 rounded-full flex items-center justify-center">
          <div className="w-6 h-6 border border-blue-400/60 rounded-full"></div>
        </div>
        <div className="absolute bottom-1/6 left-1/4 w-10 h-10 border-2 border-indigo-300/40 rounded-full flex items-center justify-center">
          <div className="w-4 h-4 border border-indigo-400/60 rounded-full"></div>
        </div>
        
        {/* ط®ط·ظˆط· طھط¹ظƒط³ ط§ظ„طھط¯ط±ط¬ ط§ظ„ط£ظƒط§ط¯ظٹظ…ظٹ */}
        <div className="absolute top-1/2 left-0 w-1 h-20 bg-gradient-to-b from-blue-300/50 via-indigo-300/50 to-purple-300/50"></div>
        <div className="absolute top-1/2 right-0 w-1 h-20 bg-gradient-to-b from-purple-300/50 via-indigo-300/50 to-blue-300/50"></div>
        
        {/* ظ†ظ‚ط§ط· طھط¹ظƒط³ ط§ظ„ط¥ظ†ط¬ط§ط²ط§طھ ط§ظ„ط£ظƒط§ط¯ظٹظ…ظٹط© */}
        <div className="absolute top-1/5 left-1/2 w-1 h-1 bg-blue-500/80 rounded-full"></div>
        <div className="absolute top-2/5 left-1/2 w-1 h-1 bg-indigo-500/80 rounded-full"></div>
        <div className="absolute top-3/5 left-1/2 w-1 h-1 bg-purple-500/80 rounded-full"></div>
        <div className="absolute top-4/5 left-1/2 w-1 h-1 bg-blue-600/80 rounded-full"></div>
        
        {/* ط£ط´ظƒط§ظ„ ط¥ط¶ط§ظپظٹط© طھط¹ظƒط³ ط§ظ„ظ…ط¹ط±ظپط© */}
        <div className="absolute top-1/3 right-1/6 w-8 h-8 bg-gradient-to-br from-blue-200/30 to-indigo-200/30 rounded-full transform rotate-45"></div>
        <div className="absolute bottom-1/3 left-1/6 w-6 h-6 bg-gradient-to-br from-indigo-200/30 to-purple-200/30 rounded-full transform -rotate-45"></div>
        <div className="absolute top-2/3 right-1/3 w-10 h-10 bg-gradient-to-br from-purple-200/30 to-blue-200/30 rounded-full transform rotate-12"></div>
        
        {/* ط®ط·ظˆط· ط¥ط¶ط§ظپظٹط© طھط¹ظƒط³ ط§ظ„طھظ‚ط¯ظ… */}
        <div className="absolute top-1/6 left-1/3 w-24 h-0.5 bg-gradient-to-r from-blue-300/40 to-transparent transform rotate-45"></div>
        <div className="absolute bottom-1/6 right-1/3 w-20 h-0.5 bg-gradient-to-l from-indigo-300/40 to-transparent transform -rotate-45"></div>
        <div className="absolute top-3/4 left-1/4 w-16 h-0.5 bg-gradient-to-r from-purple-300/40 to-transparent transform rotate-30"></div>
        
        {/* ط£ط´ظƒط§ظ„ طھط¹ظƒط³ ط§ظ„ط´ظ‡ط§ط¯ط§طھ ط§ظ„ظ…طھظ‚ط¯ظ…ط© */}
        <div className="absolute top-1/4 left-1/5 w-14 h-14 border border-blue-300/30 rounded-lg transform rotate-12 flex items-center justify-center">
          <div className="w-8 h-8 border border-blue-400/50 rounded-lg transform -rotate-12"></div>
        </div>
        <div className="absolute bottom-1/4 right-1/5 w-12 h-12 border border-indigo-300/30 rounded-lg transform -rotate-12 flex items-center justify-center">
          <div className="w-6 h-6 border border-indigo-400/50 rounded-lg transform rotate-12"></div>
        </div>
        
        {/* ظ†ظ‚ط§ط· ط¥ط¶ط§ظپظٹط© طھط¹ظƒط³ ط§ظ„ظ…ط¹ط±ظپط© */}
        <div className="absolute top-1/8 right-1/8 w-1.5 h-1.5 bg-blue-400/70 rounded-full animate-ping" style={{animationDelay: '0.3s'}}></div>
        <div className="absolute top-3/8 left-1/8 w-1 h-1 bg-indigo-400/70 rounded-full animate-ping" style={{animationDelay: '0.8s'}}></div>
        <div className="absolute bottom-1/8 right-3/8 w-2 h-2 bg-purple-400/70 rounded-full animate-ping" style={{animationDelay: '1.2s'}}></div>
        <div className="absolute bottom-3/8 left-3/8 w-1.5 h-1.5 bg-blue-500/70 rounded-full animate-ping" style={{animationDelay: '0.6s'}}></div>
        
        {/* ط£ط´ظƒط§ظ„ طھط¹ظƒط³ ط§ظ„ظƒطھط¨ ط§ظ„ظ…ظپطھظˆط­ط© */}
        <div className="absolute top-1/2 right-1/8 w-12 h-16 bg-gradient-to-b from-blue-200/25 to-indigo-200/25 rounded-sm transform rotate-6"></div>
        <div className="absolute top-1/2 right-1/8 w-12 h-16 bg-gradient-to-b from-indigo-200/25 to-purple-200/25 rounded-sm transform -rotate-6 ml-2"></div>
        
        {/* ط®ط·ظˆط· طھط¹ظƒط³ ط§ظ„طھط¯ط±ط¬ ط§ظ„ط£ظƒط§ط¯ظٹظ…ظٹ */}
        <div className="absolute top-1/6 right-1/2 w-1 h-16 bg-gradient-to-b from-blue-300/40 via-indigo-300/40 to-purple-300/40"></div>
        <div className="absolute bottom-1/6 left-1/2 w-1 h-16 bg-gradient-to-b from-purple-300/40 via-indigo-300/40 to-blue-300/40"></div>
        
        {/* ط£ط´ظƒط§ظ„ طھط¹ظƒط³ ط§ظ„ظ…ط®طھط¨ط±ط§طھ ظˆط§ظ„طھط¬ط§ط±ط¨ */}
        <div className="absolute top-2/3 left-1/8 w-8 h-8 border-2 border-blue-300/40 rounded-full flex items-center justify-center">
          <div className="w-4 h-4 bg-blue-400/60 rounded-full"></div>
        </div>
        <div className="absolute bottom-2/3 right-1/8 w-6 h-6 border-2 border-indigo-300/40 rounded-full flex items-center justify-center">
          <div className="w-3 h-3 bg-indigo-400/60 rounded-full"></div>
        </div>
        
        {/* ط®ط·ظˆط· طھط¹ظƒط³ ط§ظ„طھظ‚ط¯ظ… ط§ظ„ط¹ظ„ظ…ظٹ */}
        <div className="absolute top-1/5 right-1/4 w-32 h-0.5 bg-gradient-to-l from-blue-300/30 via-indigo-300/30 to-purple-300/30 transform rotate-30"></div>
        <div className="absolute bottom-1/5 left-1/4 w-28 h-0.5 bg-gradient-to-r from-purple-300/30 via-indigo-300/30 to-blue-300/30 transform -rotate-30"></div>
      </div>

      {/* ط¨ط·ط§ظ‚ط© طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ */}
      <div className="relative w-full max-w-md">
        <div className="bg-white/90 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/30 p-6 hover:shadow-glow transition-all duration-300">
          {/* ط´ط¹ط§ط± ط§ظ„ظƒظ„ظٹط© */}
          <div className="text-center mb-6">
            {/* ط´ط¹ط§ط± ط§ظ„ظƒظ„ظٹط© */}
            <div className="w-20 h-20 mx-auto mb-3 flex items-center justify-center">
              <Image 
                src="/logos/college-logo.png" 
                alt="ط´ط¹ط§ط± ظƒظ„ظٹط© ط§ظ„ط´ط±ظ‚" 
                width={80}
                height={80}
                className="w-full h-full object-contain hover:scale-105 transition-transform duration-300"
                onError={(e) => {
                  // ظپظٹ ط­ط§ظ„ط© ط¹ط¯ظ… ظˆط¬ظˆط¯ ط§ظ„ط´ط¹ط§ط±طŒ ظ†ط¹ط±ط¶ ط§ظ„ط´ط¹ط§ط± ط§ظ„ط¨ط¯ظٹظ„
                  e.currentTarget.style.display = 'none';
                  (e.currentTarget.nextElementSibling as HTMLElement)?.style.setProperty('display', 'flex');
                }}
              />
              {/* ط´ط¹ط§ط± ط¨ط¯ظٹظ„ ظپظٹ ط­ط§ظ„ط© ط¹ط¯ظ… ظˆط¬ظˆط¯ ط§ظ„طµظˆط±ط© */}
              <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center shadow-lg hover:scale-105 transition-transform duration-300 hidden">
                <span className="text-white text-2xl font-bold">ط´</span>
              </div>
            </div>
            
            {/* ط§ط³ظ… ط§ظ„ظ†ط¸ط§ظ… */}
            <div className="mb-3">
              <h1 className="text-4xl font-black mb-2" style={{ fontFamily: 'Segoe UI Black, system-ui, sans-serif' }}>
                <span className="bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent">
                  S
                </span>
                <span className="text-gray-800 font-light">HA</span>
                <span className="bg-gradient-to-r from-purple-600 via-pink-600 to-red-500 bg-clip-text text-transparent">
                  U
                </span>
              </h1>
              <div className="flex items-center justify-center space-x-1 space-x-reverse mb-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse" style={{animationDelay: '0.2s'}}></div>
                <div className="w-1 h-1 bg-pink-500 rounded-full animate-pulse" style={{animationDelay: '0.4s'}}></div>
              </div>
            </div>
            
            {/* ظ…ط¹ظ„ظˆظ…ط§طھ ط§ظ„ظƒظ„ظٹط© */}
            <div className="mb-3">
              <h2 className="text-xl font-semibold text-gray-800 mb-1">ظƒظ„ظٹط© ط§ظ„ط´ط±ظ‚</h2>
              <p className="text-gray-600 text-sm">ظ„ظ„ط¹ظ„ظˆظ… ط§ظ„طھظ‚ظ†ظٹط© ط§ظ„طھط®طµطµظٹط©</p>
            </div>
            
            <div className="w-20 h-1 bg-gradient-to-r from-blue-600 to-purple-600 mx-auto rounded-full"></div>
          </div>

          {/* ظ†ظ…ظˆط°ط¬ طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                ط§ط³ظ… ط§ظ„ظ…ط³طھط®ط¯ظ…
              </label>
              <input
                type="text"
                id="username"
                name="username"
                value={formData.username}
                onChange={handleInputChange}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white/70 backdrop-blur-sm hover:bg-white/80 focus:bg-white"
                placeholder="ط£ط¯ط®ظ„ ط§ط³ظ… ط§ظ„ظ…ط³طھط®ط¯ظ…"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white/70 backdrop-blur-sm hover:bg-white/80 focus:bg-white"
                  placeholder="ط£ط¯ط®ظ„ ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? (
                    <EyeSlashIcon className="w-5 h-5" />
                  ) : (
                    <EyeIcon className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="remember-me" className="mr-2 block text-sm text-gray-700">
                  طھط°ظƒط±ظ†ظٹ
                </label>
              </div>
              <a href="#" className="text-sm text-blue-600 hover:text-blue-500 transition-colors">
                ظ†ط³ظٹطھ ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±طں
              </a>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-4 rounded-lg font-medium hover:from-blue-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                  ط¬ط§ط±ظٹ طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„...
                </div>
              ) : (
                'طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„'
              )}
            </button>
          </form>

          {/* ظ…ط¹ظ„ظˆظ…ط§طھ ط¥ط¶ط§ظپظٹط© */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600 mb-2">
              ظ†ط¸ط§ظ… ط¥ط¯ط§ط±ط© ط´ط§ظ…ظ„ ظ„ظƒظ„ظٹط© ط§ظ„ط´ط±ظ‚ ظ„ظ„ط¹ظ„ظˆظ… ط§ظ„طھظ‚ظ†ظٹط© ط§ظ„طھط®طµطµظٹط©
            </p>
            <div className="flex items-center justify-center space-x-2 space-x-reverse">
              <span className="text-xs text-gray-500">Powered by</span>
              <span className="text-xs font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                SHAU
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

