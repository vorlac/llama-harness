; case compare-144-gestr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_STR "hello"
  GE
  PRINT
  RET
.end
