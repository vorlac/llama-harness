; case binary-020-roundtrip-smoke
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_STR "hello, svm"
  PRINT
  PUSH_INT 6
  PUSH_INT 7
  MUL
  PRINT
  RET
.end
