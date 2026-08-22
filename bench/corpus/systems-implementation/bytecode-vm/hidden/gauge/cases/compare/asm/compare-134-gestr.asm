; case compare-134-gestr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR ""
  GE
  PRINT
  RET
.end
