Pod::Spec.new do |s|
  s.name           = 'LioraOpticalNative'
  s.version        = '1.0.0'
  s.summary        = 'Native deterministic optical image analysis for Liora CamWard'
  s.description    = 'Decodes locally captured camera images and extracts measurable optical clusters.'
  s.author         = 'Liora CamWard'
  s.homepage       = 'https://github.com/Lp2124/Liora-CamWard-1.0.0'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => 'https://github.com/Lp2124/Liora-CamWard-1.0.0.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
