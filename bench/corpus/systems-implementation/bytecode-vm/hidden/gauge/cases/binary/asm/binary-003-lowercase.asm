; case binary-003-lowercase
; expect exit=0 stdout=""
; lowercase mnemonics and directives assemble identically
.func main arity=0 locals=0
  push_str "hello, svm"
  print
  push_int 6
  push_int 7
  mul
  print
  ret
.end
