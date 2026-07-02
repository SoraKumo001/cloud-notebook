import { Link } from '@tanstack/react-router'

export default function NotFound() {
  return (
    <div className='min-h-screen bg-base-200 text-base-content flex flex-col items-center justify-center font-sans px-6'>
      <div className='max-w-md text-center space-y-6'>
        <div
          className='text-7xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-teal-400'
          aria-hidden='true'
        >
          404
        </div>
        <h1 className='text-2xl font-semibold text-base-content/90'>Page Not Found</h1>
        <p className='text-base-content/60 leading-relaxed'>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link to='/' className='btn btn-primary'>
          Go Home
        </Link>
      </div>
    </div>
  )
}
